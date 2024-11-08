
CDK_STACK_NAME?=magento

diff: projen
	npx cdk diff

verif:
	echo "You are going to deploy on CDK_STACK_NAME=$(CDK_STACK_NAME)"
	sleep 5

synth: projen
	npx cdk synth	

build:
	npx projen build
	
deploy: verif projen
	npx cdk deploy --require-approval=never 
deploy-no-rollback : verif projen
	npx cdk deploy --require-approval=never --no-rollback 

test : projen
	npx projen test

destroy:
	npx cdk destroy

describe:
	aws cloudformation describe-stacks --stack-name $(CDK_STACK_NAME) --query "Stacks[*].Outputs" --output table 

connect:
	@echo $(shell aws cloudformation describe-stacks --stack-name $(CDK_STACK_NAME) --query 'Stacks[*].Outputs[?OutputKey==`EcsExecCommandMagentoService`].OutputValue' --output text)
	@echo $(shell aws cloudformation describe-stacks --stack-name $(CDK_STACK_NAME) --query 'Stacks[*].Outputs[?OutputKey==`EcsExecCommandMagentoServiceAdmin`].OutputValue' --output text)

projen:
	npx projen

upgrade:
	npx projen upgrade

#run npx projen build in this not-connected container to simulate gh action build
local-test:
	 docker run -ti -v $(PWD):/src -w /src allamand/eksutils zsh    
	
local-magento:
	cd docker && docker build -t magento .
	docker rm magento
	docker run -d --name magento --env MAGENTO_ADMIN_TASK=yes magento /opt/bitnami/scripts/magento/run.sh
	sleep 2
	docker logs magento -f