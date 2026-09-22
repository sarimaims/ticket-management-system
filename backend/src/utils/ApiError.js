export default class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }

  static badRequest(message, details) {
    return new ApiError(400, message, details);
  }

  static unauthorized(message = 'You must be signed in.') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'You do not have access to this.') {
    return new ApiError(403, message);
  }

  static notFound(message = 'Not found.') {
    return new ApiError(404, message);
  }

  static conflict(message) {
    return new ApiError(409, message);
  }

  /** Configured away, not broken: the caller can try again once it is set up. */
  static unavailable(message = 'That part of the service is not available.') {
    return new ApiError(503, message);
  }
}
