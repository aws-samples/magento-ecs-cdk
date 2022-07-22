activities=$(aws autoscaling describe-scaling-activities --auto-scaling-group-name "magento72-Asg1ASG8A2F9427-14BDPN7DBF734")
for row in $(echo "${activities}" | jq -r '.Activities[] | @base64'); do
_jq() {
echo ${row} | base64 --decode | jq -r ${1}
}
start_time=$(_jq '.StartTime')
end_time=$(_jq '.EndTime')
activity=$(_jq '.Description')
echo $start_time $activity Duration: $(dateutils.ddiff  $start_time $end_time)
#echo $activity $start_time $end_time Duration: $(dateutils.ddiff  $start_time $end_time)
done