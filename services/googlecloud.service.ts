import { Storage } from "@google-cloud/storage";
import { Config } from "../utils/config";

// Configure Google Cloud Storage
const storage = new Storage({
  projectId: Config.GCP_PROJECT_ID,
});
// Reference your Cloud Storage bucket
const bucket = storage.bucket(Config.GCS_BUCKET_NAME as string);

export const uploadImage = async (
  file: Express.Multer.File,
  location: string
): Promise<string> => {
  const blob = bucket.file(`niger-secureng/${location}`);
  const blobStream = blob.createWriteStream({
    resumable: false,
    public: true,
  });

  return new Promise((resolve, reject) => {
    blobStream.on("error", (_err) => {
      reject(new Error(`Unable to upload image, something went wrong`));
    });

    blobStream.on("finish", async () => {
      const publicUrl = `${Config.GCS_BUCKET_URL}/${blob.name}`;
      resolve(publicUrl);
    });

    blobStream.end(file.buffer);
  });
};
