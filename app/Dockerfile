FROM python:3.8-alpine3.11

RUN pip install flask boto3 requests

COPY ./print_task_cap_providers.py /content/

ENV FLASK_APP="/content/print_task_cap_providers.py"

CMD ["flask", "run", "--host=0.0.0.0", "--port=80"]
