FROM bitnami/magento
LABEL maintainer "Bitnami <containers@bitnami.com>"

USER root

## Install 'vim'
RUN install_packages vim

RUN chown -R daemon:daemon /opt/bitnami/
RUN chown -R daemon:daemon /bitnami/magento

#RUN sed -i -r 's/#LoadModule ratelimit_module/LoadModule ratelimit_module/' /opt/bitnami/apache/conf/httpd.conf

RUN sed -i -r 's/    MinSpareServers          5/    MinSpareServers         10/' /opt/bitnami/apache/conf/extra/httpd-mpm.conf
RUN sed -i -r 's/    MaxSpareServers         10/    MaxSpareServers         20/' /opt/bitnami/apache/conf/extra/httpd-mpm.conf

#RUN sed -i -r 's/    Require host .example.com/    Require host .ecs.demo3.allamand.com/' /opt/bitnami/apache/conf/extra/httpd-info.conf
RUN sed -i -r 's/#ExtendedStatus On/ExtendedStatus On/' /opt/bitnami/apache/conf/extra/httpd-info.conf

RUN sed -i -r 's/    LogFormat .* common/LogFormat "{ \\"time\\":\\"%{%Y-%m-%dT%T}t.%{usec_frac}t%{%z}t\\", \\"remoteIP\\":\\"%a\\", \\"host\\":\\"%V\\", \\"requestPath\\":\\"%U\\", \\"query\\":\\"%q\\", \\"method\\":\\"%m\\", \\"status\\":\\"%>s\\", \\"userAgent\\":\\"%{User-agent}i\\", \\"referer\\":\\"%{Referer}i\\", \\"timeRequest\\":\\"%{ms}T\\", \\"connStatus\\":\\"%X\\", \\"traceID\\":\\"%{X-Amzn-Trace-Id}i\\" }" common/' /opt/bitnami/apache/conf/httpd.conf

COPY scripts/post-init /docker-entrypoint-init.d/

#Custom Entrypoint to update Magento Host
COPY entrypoint.sh /opt/bitnami/scripts/magento/

USER daemon
