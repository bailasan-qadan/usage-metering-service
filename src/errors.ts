export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string, code = "bad_request") {
    super(400, code, message);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message: string, code = "unauthorized") {
    super(401, code, message);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message: string, code = "forbidden") {
    super(403, code, message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string, code = "not_found") {
    super(404, code, message);
  }
}

export class ConflictError extends HttpError {
  constructor(message: string, code = "conflict") {
    super(409, code, message);
  }
}
