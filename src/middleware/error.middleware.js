import ApiError from "../utils/ApiError.js";

export const notFound = (req, res, next) => {
  next(new ApiError(404, `Route not found: ${req.originalUrl}`));
};

export const errorHandler = (err, req, res, next) => {
  let error = err;

  if (!(error instanceof ApiError)) {
    const statusCode = error.statusCode || (error.name === "CastError" ? 400 : 500);
    let message = error.message || "Internal Server Error";

    if (error.name === "CastError") message = `Invalid ${error.path}: ${error.value}`;
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      message = `Duplicate value for field: ${field}`;
    }
    if (error.name === "ValidationError") {
      message = Object.values(error.errors).map((e) => e.message).join(", ");
    }

    error = new ApiError(statusCode, message, [], process.env.NODE_ENV === "development" ? err.stack : "");
  }

  return res.status(error.statusCode).json({
    success: false,
    message: error.message,
    errors: error.errors,
    ...(process.env.NODE_ENV === "development" && { stack: error.stack }),
  });
};
