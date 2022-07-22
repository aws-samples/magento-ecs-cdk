# ecs_exec_service CLUSTER SERVICE CONTAINER
#https://github.com/pahud/ecs-exec-cdk-demo/blob/main/src/helper.sh
function ecs_exec_service() {
  CLUSTER=$1
  SERVICE=$2
  CONTAINER=$3
  TASK=$(aws ecs list-tasks --service-name $SERVICE --cluster $CLUSTER --query 'taskArns[0]' --output text)
  ecs_exec_task $CLUSTER $TASK $CONTAINER
}

# ecs_exec_task CLUSTER TASK CONTAINER
function ecs_exec_task() {
  set -x
  aws ecs execute-command  \
      --cluster $1 \
      --task $2 \
      --container $3 \
      --command "/bin/bash" \
      --interactive
  set +x
}