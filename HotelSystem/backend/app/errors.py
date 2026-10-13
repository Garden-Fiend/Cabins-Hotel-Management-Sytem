from uuid import uuid4


class DomainError(Exception):
    def __init__(self, code: str, message: str, status: int = 409):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)

    def response(self):
        return dict(code=self.code, message=self.message, field_errors=[], request_id=str(uuid4()))
