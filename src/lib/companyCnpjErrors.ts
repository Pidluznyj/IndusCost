export class CompanyIntelligenceError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(message: string, code: string, httpStatus: number) {
    super(message);
    this.name = "CompanyIntelligenceError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
