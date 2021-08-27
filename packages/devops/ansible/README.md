# Ansible

## Installation

Need python 3 / pip.

```bash
sudo pip3 install ansible pymongo
sudo apt install ruby-dotenv

# Collections
ansible-galaxy install -r requirements.yml
```

## Environment

Create a `.env` file with the environment variables.

You can then run ansible commands preceded with `dotenv`: `dotenv ansible-playbook ...` and it will load the config in the `.env` file.

Secrets:

- `MONGODB_KEYFILE_CONTENTS` : Content of the keyfile authentication for the replicaset
<!-- - `MONGODB_LVM_SIZE` : Size of the volume containing the databe, in MB. You can use suffixes, eg `"10g"` for ten GB. -->
- `MONGODB_ADMIN_USER`
- `MONGODB_ADMIN_PASSWORD`
- `MONGODB_SITE_PASSWORD`
- `MONGODB_GAMESERVER_PASSWORD`
- `MONGODB_NODEBB_PASSWORD`
- `MAILING_API_KEY`
- `MAILING_DOMAIN`
- `SESSION_SECRET`
- `JWT_PUBLIC_KEY`
- `JWT_PRIVATE_KEY`
- `SOCIAL_GOOGLE_ID`
- `SOCIAL_GOOGLE_SECRET`
- `SOCIAL_DISCORD_ID`
- `SOCIAL_DISCORD_SECRET`
- `SOCIAL_FACEBOOK_ID`
- `SOCIAL_FACEBOOK_SECRET`

## MongoDB installs

```sh
dotenv ansible-playbook -i inventory.yml playbooks/mongodb.yml
```

Make sure port 27017 in your architecture is only open to dbs & webservers

## Webservers

```sh
dotenv ansible-playbook -i inventory.yml playbooks/webserver.yml
```

Make sure ports 5080X are only open to load balancer
