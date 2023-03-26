import { Mina, PrivateKey, isReady, shutdown } from 'snarkyjs';

import * as fs from 'fs/promises';
import * as path from 'path';

async function writeAccountToBerkeleyJson(privateK: PrivateKey): Promise<void> {
  try {
    const berkeleyConfig = await readConfig();
    const filePath = path.resolve(berkeleyConfig!.keyPath);
    const content = {
      privateKey: privateK.toBase58(),
      publicKey: privateK.toPublicKey().toBase58(),
    };

    await fs.writeFile(filePath, JSON.stringify(content, null, 2), {
      encoding: 'utf-8',
    });
    console.log(
      `Successfully written private and public key to /keys/berkeley.json`
    );
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error writing to file: ${error.message}`);
    } else {
      console.error('An unexpected error occurred while writing to file.');
    }
  }
}

interface NetworkConfig {
  mina: string;
  archive: string;
  keyPath: string;
}
async function readConfig(): Promise<NetworkConfig | undefined> {
  try {
    const filePath = path.resolve('config.json');
    const fileContent = await fs.readFile(filePath, { encoding: 'utf-8' });
    const jsonData = JSON.parse(fileContent);
    return jsonData.networks.berkeley as NetworkConfig;
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`Error reading JSON file: ${error.message}`);
    } else {
      console.error(
        'An unexpected error occurred while reading the JSON file.'
      );
    }
  }
}

/**
 * It requests a small amount of Mina from the faucet, and then writes the
 * private and public key to the keys/berkeley.json file.
 */
async function requestFromFaucet() {
  await isReady;

  console.log('Requesting Mina from faucet, this can take a few minutes...');
  const berkeleyConfig = await readConfig();
  let Berkeley = Mina.Network(berkeleyConfig!.mina);
  Mina.setActiveInstance(Berkeley);

  const privateKey = PrivateKey.random();
  const publicKey = privateKey.toPublicKey();
  await Mina.faucet(publicKey);

  console.log('Faucet successful, address:', publicKey.toBase58());
  console.log(
    `Check blockchain explorer for balance: https://minascan.io/berkeley/address/${publicKey.toBase58()}/txs`
  );
  console.log('Wait at least 3 minutes before trying to deploy a contract.');
  await writeAccountToBerkeleyJson(privateKey);

  await shutdown();
}

requestFromFaucet();
