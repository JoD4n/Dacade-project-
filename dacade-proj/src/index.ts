import { Principal } from '@dfinity/principal';
import { ic, Result, Opt, StableBTreeMap, binaryAddressFromPrincipal, binaryAddressFromAddress, hexAddressFromPrincipal } from 'azle';
import { managementCanister, icp } from 'azle/canisters';
import { Ledger } from 'azle/canisters/ledger';

type User = Record<{
  id: bigint;
  createdAt: bigint;
  updatedAt: Opt<bigint>;
  deposited: bigint;
  address: Principal;
  winamount: bigint;
}>;

type WithdrawalError = 'InsufficientFunds' | 'TransferError';
type BettingError = 'InsufficientFunds' | 'RandomnessError' | 'AccountNotFoundError';
type DepositError = 'DepositError' | 'InsufficientBalance';
type CommonError = 'ErrorOccurred';

const UserStorage = new StableBTreeMap<Principal, User>(0, 44, 2048);

export function createAccount(): Result<User, string> {
  const caller = ic.caller();
  if (UserStorage.contains(caller)) {
    return Result.Err<User, string>('You already have an account');
  } else {
    const message: User = {
      id: BigInt(Date.now()),
      createdAt: ic.time(),
      updatedAt: Opt.Some(ic.time()),
      deposited: 0n,
      address: caller,
      winamount: 0n,
    };
    UserStorage.insert(caller, message);
    return Result.Ok<User, string>(message);
  }
}

export async function withdraw(amount: bigint): Promise<Result<string, WithdrawalError>> {
  const caller = ic.caller();
  const user = UserStorage.get(caller);
  if (user) {
    const fromSubAccount = binaryAddressFromPrincipal(ic.id(), 0);
    const currentWithdrawableBalance = user.deposited + user.winamount;
    if (currentWithdrawableBalance < amount) {
      return Result.Err<bigint, WithdrawalError>('InsufficientFunds');
    }

    const transferResult = await icp.transfer({
      memo: 0n,
      amount: { e8s: amount },
      fee: { e8s: 10000n },
      from_subaccount: Opt.Some(fromSubAccount),
      to: binaryAddressFromAddress(caller.toString()),
      created_at_time: Opt.None,
    }).call();

    if (transferResult.Err) {
      return Result.Err<string, WithdrawalError>('TransferError');
    }

    return Result.Ok<string, WithdrawalError>(`${amount} withdrawn`);
  } else {
    return Result.Err<string, WithdrawalError>('AccountNotFoundError');
  }
}

export async function input(num: bigint): Promise<Result<string, BettingError>> {
  const caller = ic.caller();
  const user = UserStorage.get(caller);
  if (user) {
    let deposit = user.deposited;
    if (deposit < 10n) {
      return Result.Err<string, BettingError>('InsufficientFunds');
    }
    const randomNum = await getRandomness();
    if (randomNum.Ok === num) {
      user.winamount = user.winamount + 20n;
      user.deposited = user.deposited - 10n;
      user.updatedAt = Opt.Some(ic.time());
      UserStorage.insert(caller, { ...user });
      return Result.Ok<string, BettingError>('You won');
    } else {
      user.deposited = user.deposited - 10n;
      user.updatedAt = Opt.Some(ic.time());
      UserStorage.insert(caller, { ...user });
      return Result.Ok<string, BettingError>('You lost');
    }
  } else {
    return Result.Err<string, BettingError>('AccountNotFoundError');
  }
}

export async function getRandomness(): Promise<Result<bigint, BettingError>> {
  const randomnessResult = await managementCanister.raw_rand().call();
  if (randomnessResult.Ok) {
    return Result.Ok<bigint, BettingError>(BigInt(randomnessResult.Ok[4] % 20));
  } else {
    return Result.Err<bigint, BettingError>('RandomnessError');
  }
}

export async function deposit(): Promise<Result<string, DepositError>> {
  const caller = ic.caller();
  return new Promise(async (resolve) => {
    const user = UserStorage.get(caller);
    if (user) {
      const fromSubAccount = binaryAddressFromPrincipal(ic.id(), generateUniqueNumber(caller));
      const toSubAccount = binaryAddressFromPrincipal(ic.id(), 0);
      const balance = (await icp.account_balance({ account: fromSubAccount }).call()).Ok?.e8s;

      if (balance !== undefined) {
        const message: User = { ...user, deposited: balance };
        UserStorage.insert(caller, message);

        const transferResult = await icp.transfer({
          memo: 0n,
          amount: { e8s: balance },
          fee: { e8s: 10000n },
          from_subaccount: Opt.Some(fromSubAccount),
          to: toSubAccount,
          created_at_time: Opt.None,
        }).call();

        if (transferResult.Err) {
          resolve(Result.Err<string, DepositError>('DepositError'));
        } else {
          resolve(Result.Ok<string, DepositError>('Icp tokens deposited'));
        }
      } else {
        resolve(Result.Err<string, DepositError>('InsufficientBalance'));
      }
    } else {
      resolve(Result.Err<string, DepositError>('AccountNotFoundError'));
    }
  });
}

export function getDepositedAmount(): Result<bigint, CommonError> {
  const caller = ic.caller();
  const user = UserStorage.get(caller);
  if (user) {
    return Result.Ok<bigint, CommonError>(user.deposited);
  } else {
    return Result.Err<bigint, CommonError>('AccountNotFoundError');
  }
}

export function getWinAmount(): Result<bigint, CommonError> {
  const caller = ic.caller();
  const user = UserStorage.get(caller);
  if (user) {
    return Result.Ok<bigint, CommonError>(user.winamount);
  } else {
    return Result.Err<bigint, CommonError>('AccountNotFoundError');
  }
}

export function getDepositAddress(): string {
  const caller = ic.caller();
  const uniqueNumber = generateUniqueNumber(caller);
  return hexAddressFromPrincipal(ic.id(), uniqueNumber);
}

function generateUniqueNumber(principal: Principal): number {
  const hexadecimal = principal.toHex();
  const bigIntValue = BigInt(hexadecimal);
  const uniqueNumber = Number(bigIntValue);
  return uniqueNumber;
}
