/**
 * Puts every department that predates units under one, so the new required
 * field has a value everywhere.
 *
 *   npm run units:migrate
 *   DEFAULT_UNIT_NAME="Aims Healthcare" npm run units:migrate
 *
 * Idempotent and additive: it only touches departments that have no unit, and
 * it never deletes anything. Run it once per database - including the live one.
 */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import Department from '../models/Department.js';
import Unit from '../models/Unit.js';

const NAME = process.env.DEFAULT_UNIT_NAME || 'Head Office';

async function run() {
  await connectDatabase();

  // `unit` is required by the schema now, so these are read raw: a document
  // missing one would not survive validation on the way in.
  const orphans = await Department.find({
    $or: [{ unit: { $exists: false } }, { unit: null }],
  }).select('name code');

  if (orphans.length === 0) {
    console.log('Every department already belongs to a unit. Nothing to do.');
    await disconnectDatabase();
    return;
  }

  let unit = await Unit.findOne({ name: NAME });
  if (!unit) {
    let code = Unit.codeFrom(NAME);
    let suffix = 1;
    while (await Unit.exists({ code })) {
      suffix += 1;
      code = `${Unit.codeFrom(NAME)}${suffix}`.slice(0, 8);
    }
    unit = await Unit.create({
      name: NAME,
      code,
      description: 'Created when units were introduced. Rename or split it as needed.',
    });
    console.log(`Created unit ${unit.name} (${unit.code})`);
  } else {
    console.log(`Using existing unit ${unit.name} (${unit.code})`);
  }

  const result = await Department.updateMany(
    { $or: [{ unit: { $exists: false } }, { unit: null }] },
    { $set: { unit: unit._id } },
  );

  console.log(`Filed ${result.modifiedCount} department(s) under ${unit.name}:`);
  for (const department of orphans) console.log(`   ${department.name} (${department.code})`);

  const left = await Department.countDocuments({
    $or: [{ unit: { $exists: false } }, { unit: null }],
  });
  console.log(left === 0 ? 'No department is left without a unit.' : `Still missing: ${left}`);

  await disconnectDatabase();
}

run().catch(async (error) => {
  console.error('Migration failed:', error.message);
  await disconnectDatabase();
  process.exit(1);
});
