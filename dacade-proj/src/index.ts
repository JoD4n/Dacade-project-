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

export async function withdraw(amount: bigint): Promise<Result<string, string>> {
  const caller = ic.caller();
  const user = UserStorage.get(caller);
  if (user) {
    const fromSubAccount = binaryAddressFromPrincipal(ic.id(), 0);
    const currentWithdrawableBalance = user.deposited + user.winamount;
    if (currentWithdrawableBalance < amount) {
      return Result.Err<string, string>("You don't have enough funds");
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
      return Result.Err<string, string>(transferResult.Err.toString());
    }

    return Result.Ok<string, string>(`${amount} withdrawn`);
  } else {
    return Result.Err<string, string>('Withdrawal Failed');
  }
}

export async function input(num: bigint): Promise<Result<string, string>> {
  const caller = ic.caller();
  const user = UserStorage.get(caller);
  if (user) {
    let deposit = user.deposited;
    if (deposit < 10n) {
      return Result.Err<string, string>('Insufficient Funds');
    }
    const randomNum = await getRandomness();
    if (randomNum.Ok === num) {
      user.winamount = user.winamount + 20n;
      user.deposited = user.deposited - 10n;
      user.updatedAt = Opt.Some(ic.time());
      UserStorage.insert(caller, { ...user });
      return Result.Ok<string, string>('You won');
    } else {
      user.deposited = user.deposited - 10n;
      user.updatedAt = Opt.Some(ic.time());
      UserStorage.insert(caller, { ...user });
      return Result.Ok<string, string>('You lost');
    }
  } else {
    return Result.Err<string, string>('Error occurred');
  }
}

export async function getRandomness(): Promise<Result<bigint, string>> {
  const randomnessResult = await managementCanister.raw_rand().call();
  if (randomnessResult.Ok) {
    return Result.Ok<bigint, string>(BigInt(randomnessResult.Ok[4] % 20));
  } else {
    return Result.Err<bigint, string>('Error occurred while generating randomness');
  }
}

export function deposit(): Promise<Result<string, string>> {
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
          resolve(Result.Err<string, string>(transferResult.Err.toString()));
        } else {
          resolve(Result.Ok<string, string>('Icp tokens deposited'));
        }
      } else {
        resolve(Result.Err<string, string>('Please deposit ICP tokens to the specified address'));
      }
    } else {
      resolve(Result.Err<string, string>('Error occurred'));
    }
  });
}

export function getDepositedAmount(): Result<bigint, string> {
  const caller = ic.caller();
  const user = UserStorage.get(caller);
  if (user) {
    return Result.Ok<bigint, string>(user.deposited);
  } else {
    return Result.Err<bigint, string>('Error occurred');
  }
}

export function getWinAmount(): Result<bigint, string> {
  const caller = ic.caller();
  const user = UserStorage.get(caller);
  if (user) {
    return Result.Ok<bigint, string>(user.winamount);
  } else {
    return Result.Err<bigint, string>('No id found');
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
