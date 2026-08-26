/**
 * Erros de autorização/domínio da ficha funcional.
 */

export class PeopleProfileAccessError extends Error {
  status: number;
  code: string;
  constructor(code: string, message: string, status = 403) {
    super(message);
    this.name = "PeopleProfileAccessError";
    this.code = code;
    this.status = status;
  }
}
