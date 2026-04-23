import { db } from "~/platform/db";
import { resetLegacyScreeningData } from "~/modules/screening/server/application/reset-legacy-screening-data";

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
