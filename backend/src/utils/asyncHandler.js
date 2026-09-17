/** Forwards rejected promises to the error handler so controllers stay flat. */
export default function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
