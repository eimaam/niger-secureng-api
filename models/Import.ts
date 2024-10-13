import mongoose, { Schema, Document } from "mongoose";

interface IImporter extends Document {
  nin: string;
  fullName: string;
  businessName: string;
  phone: string;
  address: string;
  image: string;
  createdBy: mongoose.Types.ObjectId;
}

const ImporterSchema = new Schema<IImporter>({
  fullName: { type: String, required: true },
  nin: { type: String, required: true, length: 11 },
  businessName: { type: String, required: true },
  phone: { type: String, required: true, length: 11 },
  address: { type: String, required: true },
  image: { type: String, required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
});

const Importer = mongoose.model<IImporter>("Importer", ImporterSchema);

export { Importer, IImporter };
