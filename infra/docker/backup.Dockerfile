FROM alpine:3.21
RUN apk add --no-cache postgresql17-client restic curl tzdata tini bash
COPY infra/backup/backup.sh infra/backup/restore.sh /usr/local/bin/
COPY infra/backup/crontab /etc/crontabs/root
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh
ENV TZ=Asia/Kolkata
ENTRYPOINT ["/sbin/tini","--"]
CMD ["crond","-f","-l","8"]
