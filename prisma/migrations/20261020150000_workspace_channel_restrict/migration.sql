-- DropForeignKey
ALTER TABLE "workspaces" DROP CONSTRAINT "workspaces_channel_id_fkey";

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

