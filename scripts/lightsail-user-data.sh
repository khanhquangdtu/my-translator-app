# Provisioning for the `my-translator` Lightsail instance. Runs once, as root,
# on first boot -- passed via `create-instances --user-data`.
#
# TWO LIGHTSAIL QUIRKS SHAPE THIS FILE. Both were found the hard way:
#
#  1. No shebang, and no bash syntax. Lightsail CONCATENATES this file onto the
#     end of its own `#!/bin/sh` bootstrap script (the one that installs the SSH
#     CA key). The combined script runs under dash, and any `#!/bin/bash` here
#     would land mid-file as an ordinary comment. `set -o pipefail` is a dash
#     syntax error, which aborts provisioning before Docker is installed while
#     the instance still boots and accepts SSH -- a failure that looks like
#     nothing is wrong until the deploy fails much later.
#
#  2. ASCII only. Non-ASCII bytes get mangled in transit; box-drawing
#     characters in comments came back as garbage.
#
# Output lands in /var/log/cloud-init-output.log. Read that first if a deploy
# misbehaves right after provisioning; `cloud-init status --long` gives the
# short version.

set -eux

export DEBIAN_FRONTEND=noninteractive

# --- swap ---------------------------------------------------------------
# The instance has 4 GB, which is enough for `next build` on its own. This is
# headroom for the case the build runs while Mongo is already resident, not a
# load-bearing part of the setup. Guarded so a re-run cannot corrupt a live
# swapfile.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

# Low on purpose: swap here is an OOM backstop, not a tier the workload should
# live in. Mongo in particular gets slow the moment it is paged out.
echo 'vm.swappiness=10' >/etc/sysctl.d/99-swappiness.conf
sysctl -w vm.swappiness=10

# --- docker -------------------------------------------------------------
# From Docker's own repo, not Ubuntu's: `docker.io` in universe ships without
# the compose v2 plugin, and the deploy needs `docker compose`.
apt-get update
apt-get install -y ca-certificates curl gnupg git unattended-upgrades

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

ARCH=$(dpkg --print-architecture)
CODENAME=$(. /etc/os-release && echo "$VERSION_CODENAME")
echo "deb [arch=$ARCH signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $CODENAME stable" \
  >/etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y \
  docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

systemctl enable --now docker

# So the default login can run docker without sudo. Takes effect on the next
# SSH session, not the one that provisioning runs in.
usermod -aG docker ubuntu

# --- unattended security updates ----------------------------------------
dpkg-reconfigure -f noninteractive unattended-upgrades

# Presence of this file is the signal that provisioning ran to completion.
# `set -e` above means any failure aborts before this line is reached.
echo "user-data finished at $(date -Is)" >/var/log/my-translator-provision.done
