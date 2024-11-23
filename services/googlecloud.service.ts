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
  const extension = file?.mimetype?.split('/')[1]; // Get the file extension

  // verify that the file is an image - image/png, image/jpeg, image/jpg, image/gif are allowed
  const allowedExtensions = ['png', 'jpeg', 'jpg', 'gif'];
  if (!allowedExtensions.includes(extension)) {
    throw new Error('Invalid file type, only images are allowed');
  }

  const filePath = `niger-secureng/${location}.${extension}`;

  // check if the file already exists
  const fileExists = await bucket.file(filePath).exists();

  if (fileExists[0]) {
    throw new Error("File with the same name already exists");
  }

  const blob = bucket.file(filePath);
  const blobStream = blob.createWriteStream({
    resumable: false,
    public: true,
    metadata: {
      contentType: file?.mimetype,
    }
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
