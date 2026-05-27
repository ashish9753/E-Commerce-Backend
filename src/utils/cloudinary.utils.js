import { v2 as cloudinary } from "cloudinary";
import { Readable } from "stream";

const configure = () => cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const uploadToCloudinary = (buffer, folder = "ecommerce") => {
  configure();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "auto",
        transformation: [
          { width: 1200, height: 1200, crop: "limit" },
          { quality: "auto:good", fetch_format: "webp" },
        ],
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    Readable.from(buffer).pipe(stream);
  });
};

export const uploadVideoToCloudinary = (buffer, folder = "ecommerce/returns") => {
  configure();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "video" },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    Readable.from(buffer).pipe(stream);
  });
};

export const deleteFromCloudinary = async (publicId) => {
  configure();
  return cloudinary.uploader.destroy(publicId);
};

// Cloudinary URLs look like .../upload/[v123/]<folder>/.../<filename>.<ext>
// — public_id is everything after the version segment, minus the extension.
export const getPublicIdFromUrl = (url) => {
  if (!url || typeof url !== "string") return null;
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-zA-Z0-9]+)?$/);
  return match ? match[1] : null;
};

export default cloudinary;
