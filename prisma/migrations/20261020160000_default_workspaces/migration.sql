-- DropForeignKey
ALTER TABLE "agents" DROP CONSTRAINT "agents_workspace_id_fkey";

-- AlterTable
ALTER TABLE "agents" ALTER COLUMN "workspace_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "is_default" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_owner_id_key" ON "workspaces"("owner_id") WHERE (is_default);

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

