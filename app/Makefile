
VERSION=1.0
REPO=allamand/ecsdemo-capacityproviders

create-ecr:
	echo aws ecr create-repository \
    --repository-name $(REPO) \
    --image-scanning-configuration scanOnPush=true \
    --region $(AWS_REGION)

login:
	aws ecr get-login-password --region $(AWS_REGION) | docker login --username AWS --password-stdin $(ACCOUNT_ID).dkr.ecr.$(AWS_REGION).amazonaws.com

build:
	docker build -t $(ACCOUNT_ID).dkr.ecr.$(AWS_REGION).amazonaws.com/allamand/ecsdemo-capacityproviders:$(VERSION) .


push: login
	docker push $(ACCOUNT_ID).dkr.ecr.$(AWS_REGION).amazonaws.com/allamand/ecsdemo-capacityproviders:$(VERSION)

run: build
	export AWS_REGION=eu-west-1 ; \
	docker run --rm -ti -p 81:80 $(ACCOUNT_ID).dkr.ecr.$(AWS_REGION).amazonaws.com/allamand/ecsdemo-capacityproviders:$(VERSION)