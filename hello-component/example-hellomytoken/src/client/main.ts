/**
 * Hello mytoken
 */

import {
  establishConnection,
  establishPayer,
  checkProgram,
  createComponentQcom,
  updateComponentQcom,
  reportComponentQcom,
  createComponentNvd,
  updateComponentNvd,
  reportComponentNvd,
  addAsChild,
} from './hello_mytoken';

async function main() {
  console.log("Let's say hello to a Solana account...");

  // Establish connection to the cluster
  await establishConnection();

  // Determine who pays for the fees
  await establishPayer(); // sol, detect money from wallet id.json

  // Check if the program has been deployed
  await checkProgram();



  // create component of an account
  await createComponentQcom();

  // retrieve latest component info from ledger
  await reportComponentQcom();

  // update component of an account
  await updateComponentQcom();

  // retrieve latest component info from ledger
  await reportComponentQcom();



  // create component of an account
  await createComponentNvd();

  // retrieve latest component info from ledger
  await reportComponentNvd();

  // update component of an account
  await updateComponentNvd();

  // retrieve latest component info from ledger
  await reportComponentNvd();



  // add component as child of another
  await addAsChild();

  // retrieve latest component info from ledger
  await reportComponentNvd();
  await reportComponentQcom();




  console.log('Success');
}

main().then(
  () => process.exit(),
  err => {
    console.error(err);
    process.exit(-1);
  },
);
