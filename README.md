# Mina zkApp: Farm for the e2e testing program

## Description of ZkApp

This zkApp serves as a simplified yield farm designed specifically for this end-to-end testing exercise. In general, yield farms enable users to stake tokens in a smart contract and receive different tokens as rewards for their participation. The limitation of this yield farm is that it doesn't return token rewards, but calculates fictional reward amounts.

Users stake a particular token they possess within this zkApp. The zkApp applies the dispatch/reduce approach that allows multiple users to interact with the zkApp through `deposit`, `claim` and `withdraw` actions simultaneously. With each block, fictional rewards are generated according to the `rewardPerBlock` attribute of the zkApp. The application logic incorporates an algorithm, which ensures that rewards are distributed equally among all participants based on `totalStakedBalance` and respective user stakes saved in `delegatorRecord`. This algorithm is well-suited for the limited execution environment of a blockchain, storing only essential information on- and off-chain and minimal computations for calculating rewards.

The **default flow for a user** to interact with the zkApp:

- `deposit()`
  - sends a token from the user to the zkApp
  - dispatches the action `deposit`
- `claim()`
  - dispatches the action `claim`
- `withdraw()`
  - dispatches the action `withdraw`

At a later stage `rollup()` is called on the zkApp to reduce all pending actions.
Regardless of any user action, the total rewards since the last rollup are calculated and algorithm specific variables are updated (`accumulatedRewardsPerShare`).
In the case of a _deposit_ action, the zkApp creates the `delegatorRecord`. If a deposit already exists, it claims for the user before it updates the staked balance.
For _claim_, the application logic calculates the rewards for the specific user.
For _withdraw_, the application logic first claims, then sets staked balance to 0 in `delegatorRecord`.

The **default flow for an admin** to interact with the zkApp:

- `setAdmin()` can be only called once in the lifecycle of a farm
  - sets publicKey for `admin` on-chain property
- `updateRewardsPerBlock()`
  - accepts a proof for authentication/authorization
  - the proof is valid until a certain block-height
  - sets a new value for `rewardPerBlock` on-chain property

### Implementation details

This zkApp uses the ZKFS off-chain storage package `@zkfs/contract-api` in testing mode. You can find more information about this on [zkfs.io](https://www.zkfs.io).

For the custom token contract it uses an early preview of `@stove-labs/mip-token-standard`.

For subtractions and divisions, the application imports a library `@zkfs/safe-math` to avoid division by 0 and subtraction that goes into negative.
To ensure precision, values that require division are initially multiplied by a fixedPointAccuracy constant and stored as a temporary measure. When the final value is needed, the inflated number is divided by fixedPointAccuracy.

Please note that there is a piece of code that needs to be commented out when testing locally! This is described in the section [How to run tests locally](#how-to-run-tests-locally).

## Surface areas covered in this application

This zkApp covers all 9 surface areas as defined in the e2e testing requirements.

1. Recursion

A zkProgram is used to authorize a third party to call `updateRewardsPerBlock()`, in order to update on-chain values relevant for the application logic.

2. Call stack composability

The zkApp interacts with a token contract through `mayUseToken` (former isDelegateCall).

3. Actions

The zkApp dispatches user interactions as actions that get reduced at a later stage when `rollup()` is called.

4. Events

Events are emitted for user rewards and updates to totalStakedBalance of the farm.

5. Pre-conditions (account)

Actions are only dispatched if a user signature is provided. Additionally, users are prohibited from transferring a greater number of tokens than they own.

6. Pre-conditions (network)

The proof for calling `updateRewardsPerBlock()` comes with a `permissionUntilBlockHeight` public input. This value is asserted with the current network blockchain length.

7. Permissions

Various permissions are set for the token contract and the farm zkApp to control `access`, `send`, `setTokenSymbol` and many more.

8. Deploy smart contract

Deployment scripts for the zkApp farm and token contract can be found in the test files.

9. Tokens

The zkApp interacts with a custom fungible token contract.

## Instructions for how to deploy the zkApp

### How to create a Mina account

For the purpose of the _zkApps e2e testing_ program, this project comes with a pre-funded account in `keys/berkeley.json`. However, if you wish to generate a new account and request funds from a faucet, please run:

```sh
npm run init:account
```

The script creates a Mina account and requests a small amount of Mina from the faucet on Berkeley, and then writes the private and public key to `keys/berkeley.json`.

### How to build

```sh
npm run build
```

### How to run tests locally

Make sure that this code in method `Farm.rollup()` is commented out:

```typescript
Circuit.asProver(() => {
  // eslint-disable-next-line snarkyjs/no-if-in-circuit
  if (!actionsHash.equals(Reducer.initialActionsHash).toBoolean()) {
    pendingActions = pendingActions.slice(1);
  }
});
```

```sh
npm run test
npm run testw # watch mode
```

### How to run tests on Berkeley

```sh
npm run test:berkeley
# or edit .env file and set TEST_ON_BERKELEY=true
npm run test # with edited .env
```

## Public key and verification key used to deploy the zkApp(s) to Berkeley

Key-pair used to deploy can be found in `keys/berkeley.json`.
Verification key in `keys/contracts.json`.

## Expected length of running all tests

Approximately 70 minutes.

## License

[Apache-2.0](LICENSE)
