import { resetLegacyScreeningData } from "~/server/application/screening/reset-legacy-screening-data";
import { db } from "~/server/db";

async function main() {
  const result = await resetLegacyScreeningData(db);
  console.log(
    JSON.stringify(
      {
        deletedFormulaCount: result.deletedFormulaCount,
        resetWorkspaceCount: result.resetWorkspaceCount,
      },
      null,
      2,
    ),
  );
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
