/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import {
  Keypair,
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import fs from 'mz/fs';
import path from 'path';
import * as borsh from 'borsh';

import {getPayer, getRpcUrl, createKeypairFromFile} from './utils';

/**
 * Connection to the network
 */
let connection: Connection;

/**
 * Keypair associated to the fees' payer
 */
let payer: Keypair;

/**
 * Hello mytoken's program id
 */
let programId: PublicKey;

/**
 * The public keys of the accounts the components belong to
 */
let qcom: PublicKey;
let nvd: PublicKey;

/**
 * Path to program files
 */
const PROGRAM_PATH = path.resolve(__dirname, '../../dist/program');

/**
 * Path to program shared object file which should be deployed on chain.
 * This file is created when running either:
 *   - `npm run build:program-c`
 *   - `npm run build:program-rust`
 */
const PROGRAM_SO_PATH = path.join(PROGRAM_PATH, 'hellomytoken.so');

/**
 * Path to the keypair of the deployed program.
 * This file is created when running `solana program deploy dist/program/hellomytoken.so`
 */
const PROGRAM_KEYPAIR_PATH = path.join(PROGRAM_PATH, 'hellomytoken-keypair.json');

/**
 * The state of a greeting account managed by the hello mytoken program
 */
class Component {
  opcode = 0;   // u8 as defined in schema
  id = 0;       // u8 as defined in schema
  // description = 'Some short description of the component';
  description = new Uint8Array(64);
  // serial_no = 'XXX-YYY-000000';
  serial_no = new Uint8Array(16);
  parent = 0;   // u8
  children = new Uint8Array(10); // only fixed size supported by borsh

  constructor(fields: {opcode: number, id: number, description: Uint8Array, serial_no: Uint8Array, parent: number, children: Uint8Array} | undefined = undefined) {
    if (fields) {
      this.opcode = fields.opcode;
      this.id = fields.id;
      this.description = fields.description;
      this.serial_no = fields.serial_no;
      this.parent = fields.parent;
      this.children = fields.children;
    }
  }
}

const ComponentSchema = new Map([
  [Component, {kind: 'struct', fields: [
    ['opcode', 'u8'],
    ['id', 'u8'],  // types must match that in program
    ['description', [64]],
    ['serial_no', [16]],
    ['parent', 'u8'],
    ['children', [10]],
  ]}],
]);


/**
 * Borsh schema definition for greeting accounts
 */
// const GreetingSchema = new Map([
//   [GreetingAccount, {kind: 'struct', fields: [['counter', 'u32'],['d_counter', 'u32']]}],
// ]);


/**
 * The expected size of each greeting account.
 */
const COMPONENT_SIZE = borsh.serialize(
  ComponentSchema,
  new Component(),
).length;

/**
 * Establish a connection to the cluster
 */
export async function establishConnection(): Promise<void> {
  const rpcUrl = await getRpcUrl();
  connection = new Connection(rpcUrl, 'confirmed');
  const version = await connection.getVersion();
  console.log('Connection to cluster established:', rpcUrl, version);
}

/**
 * Establish an account to pay for everything
 */
export async function establishPayer(): Promise<void> {
  let fees = 0;
  if (!payer) {
    const {feeCalculator} = await connection.getRecentBlockhash();

    // Calculate the cost to fund the greeter account
    fees += await connection.getMinimumBalanceForRentExemption(COMPONENT_SIZE);

    // Calculate the cost of sending transactions
    fees += feeCalculator.lamportsPerSignature * 100; // wag

    payer = await getPayer();
  }

  let lamports = await connection.getBalance(payer.publicKey);
  if (lamports < fees) {
    // If current balance is not enough to pay for fees, request an airdrop
    const sig = await connection.requestAirdrop(
      payer.publicKey,
      fees - lamports,
    );
    await connection.confirmTransaction(sig);
    lamports = await connection.getBalance(payer.publicKey);
  }

  console.log(
    'Using account',
    payer.publicKey.toBase58(),
    'containing',
    lamports / LAMPORTS_PER_SOL,
    'SOL to pay for fees',
  );
}

/**
 * Check if the hello mytoken BPF program has been deployed
 */
export async function checkProgram(): Promise<void> {
  // Read program id from keypair file
  try {
    const programKeypair = await createKeypairFromFile(PROGRAM_KEYPAIR_PATH);
    programId = programKeypair.publicKey;
  } catch (err) {
    const errMsg = (err as Error).message;
    throw new Error(
      `Failed to read program keypair at '${PROGRAM_KEYPAIR_PATH}' due to error: ${errMsg}. Program may need to be deployed with \`solana program deploy dist/program/hellomytoken.so\``,
    );
  }

  // Check if the program has been deployed
  const programInfo = await connection.getAccountInfo(programId);
  if (programInfo === null) {
    if (fs.existsSync(PROGRAM_SO_PATH)) {
      throw new Error(
        'Program needs to be deployed with `solana program deploy dist/program/hellomytoken.so`',
      );
    } else {
      throw new Error('Program needs to be built and deployed');
    }
  } else if (!programInfo.executable) {
    throw new Error(`Program is not executable`);
  }
  console.log(`Using program ${programId.toBase58()}`);

  // Derive the address (public key) of a component account from the program so that it's easy to find later.
  // two components, each dynamically created with Owner
  const COMPONENT_SEED_QCOM = 'hello-component-qcom';
  qcom = await PublicKey.createWithSeed(
    payer.publicKey,
    COMPONENT_SEED_QCOM,
    programId,
  );

  // Check if the greeting account has already been created
  const greetedAccount_qcom = await connection.getAccountInfo(qcom);
  if (greetedAccount_qcom === null) {
    console.log(
      'Creating account',
      qcom.toBase58(),
      'to store component',
      'with storage size: ',
      COMPONENT_SIZE
    );
    const lamports = await connection.getMinimumBalanceForRentExemption(
      COMPONENT_SIZE,
    );

    const transaction = new Transaction().add(
      SystemProgram.createAccountWithSeed({
        fromPubkey: payer.publicKey,
        basePubkey: payer.publicKey,
        seed: COMPONENT_SEED_QCOM,
        newAccountPubkey: qcom,
        lamports,
        space: COMPONENT_SIZE,
        programId,
      }),
    );
    await sendAndConfirmTransaction(connection, transaction, [payer]);
  }

  // Derive the address (public key) of a greeting account from the program so that it's easy to find later.
  const COMPONENT_SEED_NVD = 'hello-component-nvd';
  nvd = await PublicKey.createWithSeed(
    payer.publicKey,
    COMPONENT_SEED_NVD,
    programId,
  );

  // Check if the greeting account has already been created
  const greetedAccount_nvd = await connection.getAccountInfo(nvd);
  if (greetedAccount_nvd === null) {
    console.log(
      'Creating account',
      nvd.toBase58(),
      'to store component',
      'with storage size: ',
      COMPONENT_SIZE
    );
    const lamports = await connection.getMinimumBalanceForRentExemption(
      COMPONENT_SIZE,
    );

    const transaction = new Transaction().add(
      SystemProgram.createAccountWithSeed({
        fromPubkey: payer.publicKey,
        basePubkey: payer.publicKey,
        seed: COMPONENT_SEED_NVD,
        newAccountPubkey: nvd,
        lamports,
        space: COMPONENT_SIZE,
        programId,
      }),
    );
    await sendAndConfirmTransaction(connection, transaction, [payer]);
  }
}




// QCOM ///////////////////////////////////////////////////////////////////////////////////////
export async function createComponentQcom(): Promise<void> {
  console.log('Creating component for account:', qcom.toBase58());

  let this_component = new Component()
  this_component.opcode = 100; // u8
  this_component.id = 101; //u8
  this_component.description = new TextEncoder().encode("Mobile CPU (8nm technology), 4 core, 4GB, 16MB cache. Made in SG.".substring(0, 64).padEnd(64,'*')); // len exactly 64bytes
  this_component.serial_no = new TextEncoder().encode("QPUA-QW-10009".substring(0, 16).padEnd(16,'0')); // len exactly 64bytes
  
  let this_component_s = borsh.serialize(
    ComponentSchema,
    this_component,
  );

  const instruction = new TransactionInstruction({
    keys: [{pubkey: qcom, isSigner: false, isWritable: true}],
    programId,
    data: Buffer.from(this_component_s),
  });
  let tx = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(instruction),
    [payer],
  );
  console.log("Transaction receipt: ", tx);
}


export async function updateComponentQcom(): Promise<void> {
  console.log('Updating component for account:', qcom.toBase58());

  let this_component = new Component()
  this_component.opcode = 101; // u8
  this_component.description = new TextEncoder().encode("Mobile CPU (8nm technology), 6 core, 8GB, 16MB cache. Made in SG.".substring(0, 64).padEnd(64,'*')); // len exactly 64bytes
  // all other fields will be ignored during uodate

  let this_component_s = borsh.serialize(
    ComponentSchema,
    this_component,
  );

  const instruction = new TransactionInstruction({
    keys: [{pubkey: qcom, isSigner: false, isWritable: true}],
    programId,
    data: Buffer.from(this_component_s),
  });
  let tx = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(instruction),
    [payer],
  );
  console.log("Transaction receipt: ", tx);
}


/**
 * Report the number of times the greeted account has been said hello to
 */
export async function reportComponentQcom(): Promise<void> {
  const accountInfo = await connection.getAccountInfo(qcom);
  if (accountInfo === null) {
    throw 'Error: cannot find the greeted account';
  }
  const component = borsh.deserialize(
    ComponentSchema,
    Component,
    accountInfo.data,
  );
  console.log(
    'Account:',
    qcom.toBase58(),
    '\n',
    'ID:',
    component.id,
    '\n',
    'Description:',
    new TextDecoder().decode(component.description),
    '\n',
    'Serial No.:',
    new TextDecoder().decode(component.serial_no),
    '\n',
    'Parent component ID:',
    component.parent,
    '\n',
    'Children components IDs:',
    component.children,
  );
}
// NVD////////////////////////////////////////////////////////////////////////////////////////
export async function createComponentNvd(): Promise<void> {
  console.log('Creating component for account:', nvd.toBase58());

  let this_component = new Component()
  this_component.opcode = 100; // u8
  this_component.id = 201; //u8
  this_component.description = new TextEncoder().encode("Integrated GPU, 512 stream cores, 1GB VRAM. Made in TW.".substring(0, 64).padEnd(64,'*')); // len exactly 64bytes
  this_component.serial_no = new TextEncoder().encode("NVD-NN-88-UYTRE".substring(0, 16).padEnd(16,'0')); // len exactly 64bytes
  
  
  let this_component_s = borsh.serialize(
    ComponentSchema,
    this_component,
  );

  const instruction = new TransactionInstruction({
    keys: [{pubkey: nvd, isSigner: false, isWritable: true}],
    programId,
    data: Buffer.from(this_component_s),
  });
  let tx = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(instruction),
    [payer],
  );
  console.log("Transaction receipt: ", tx);
}


export async function updateComponentNvd(): Promise<void> {
  console.log('Updating component for account:', nvd.toBase58());

  let this_component = new Component()
  this_component.opcode = 101; // u8
  this_component.description = new TextEncoder().encode("Integrated GPU on chip, 512 stream cores, 1GB VRAM. Made in TW.".substring(0, 64).padEnd(64,'*')); // len exactly 64bytes
  
  let this_component_s = borsh.serialize(
    ComponentSchema,
    this_component,
  );

  const instruction = new TransactionInstruction({
    keys: [{pubkey: nvd, isSigner: false, isWritable: true}],
    programId,
    data: Buffer.from(this_component_s),
  });
  let tx = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(instruction),
    [payer],
  );
  console.log("Transaction receipt: ", tx);
}


/**
 * Report the number of times the greeted account has been said hello to
 */
export async function reportComponentNvd(): Promise<void> {
  const accountInfo = await connection.getAccountInfo(nvd);
  if (accountInfo === null) {
    throw 'Error: cannot find the greeted account';
  }
  const component = borsh.deserialize(
    ComponentSchema,
    Component,
    accountInfo.data,
  );
  console.log(
    'Account:',
    nvd.toBase58(),
    '\n',
    'ID:',
    component.id,
    '\n',
    'Description:',
    new TextDecoder().decode(component.description),
    '\n',
    'Serial No.:',
    new TextDecoder().decode(component.serial_no),
    '\n',
    'Parent component ID:',
    component.parent,
    '\n',
    'Children components IDs:',
    component.children,
  );
}


// Add QCOM to NVD as child ///////////////////////////////////////////////////////////////////////////////////
export async function addAsChild(): Promise<void> {
  console.log("Adding child to parent:");
  console.log('Child:', qcom.toBase58());
  console.log('Parent:', nvd.toBase58());

  let this_component = new Component()
  this_component.opcode = 102; // u8
  
  let this_component_s = borsh.serialize(
    ComponentSchema,
    this_component,
  );

  const instruction = new TransactionInstruction({
    keys: [{pubkey: qcom, isSigner: false, isWritable: true},
      {pubkey: nvd, isSigner: false, isWritable: true}],
    programId,
    data: Buffer.from(this_component_s),
  });
  let tx = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(instruction),
    [payer],
  );
  console.log("Transaction receipt: ", tx);
}
