#!/bin/bash

NAMESPACE=$1
TAG=$2
# update helm deploy config file following document at https://confluence.csiro.au/display/OFW/KN2+Magda+Prod+Deployment+on+Google+Kubernetes+Engine
# magda-dev-kn-v0.0.41.yml
HELM_CONFIG_FILE=$3
GCLOUD_CLUSTER=kn-dev-cluster-1
GCLOUD_ZONE=australia-southeast1-a
GCLOUD_PROJECT=knowledge-network-192205
# Add GCOUD user to the project
GCLOUD_USER=kn-dev-robot
# Download the key, and put it at root directory of magda project
GCLOUD_KEY_FILE=kn-dev-robot.json


# View the page above to learn how to apply and config Google OAuth
GOOGLE_CLIENT_SECRET='Vnw5fxIwXMOEpYpTvWggtzpc' 
FACEBOOK_CLIENT_SECRET='p4ssw0rd'
AAF_CLIENT_SECRET='[([2b&}JLjeq-*4d21"P]s8L^cM4Q-{|'
# Whether the gcloud namespace created or not
NAMESPACE_EXIST=false



gcloud auth activate-service-account $GCLOUD_USER@$GCLOUD_PROJECT.iam.gserviceaccount.com --key-file=$GCLOUD_KEY_FILE
gcloud container clusters get-credentials $GCLOUD_CLUSTER --zone $GCLOUD_ZONE --project $GCLOUD_PROJECT

kubectl config set-context $(kubectl config current-context) --namespace=$NAMESPACE

cd /app && git add . && git commit -m "commit for pull" && git pull


cd /app  && yarn install && lerna link
cd /app/magda-web-server && lerna run --loglevel=debug --scope=@magda/typescript-common --scope=@magda/web-admin --scope=@magda/web-server --scope=@magda/web-client --scope=@magda/kn-web-app* build
cd /app/magda-web-server && lerna run --loglevel=debug --scope=@magda/web-server docker-build-kn -- -- --tag gcr.io/$GCLOUD_PROJECT/data61/magda-web-server:$TAG
 
 
cd /app/magda-gateway && lerna run --loglevel=debug --scope=@magda/typescript-common --scope=@magda/gateway build
cd /app/magda-gateway && lerna run --loglevel=debug --scope=@magda/gateway docker-build-kn -- -- --tag gcr.io/$GCLOUD_PROJECT/data61/magda-gateway:$TAG
 
# dap connector will be merged to magda/data61, will not need to build locally by KN team
#cd /app/magda-dap-connector && lerna run --loglevel=debug --scope=@magda/typescript-common --scope=@magda/dap-connector build
#cd /app/magda-dap-connector && lerna run --loglevel=debug --scope=@magda/dap-connector docker-build-kn -- -- --tag #gcr.io/$GCLOUD_PROJECT/data61/magda-dap-connector:$TAG

gcloud auth configure-docker
gcloud docker -- push gcr.io/$GCLOUD_PROJECT/data61/magda-web-server:$TAG
gcloud docker -- push gcr.io/$GCLOUD_PROJECT/data61/magda-gateway:$TAG
#gcloud docker -- push gcr.io/$GCLOUD_PROJECT/data61/magda-dap-connector:$TAG


cd /app/deploy/helm && helm upgrade $NAMESPACE magda  --set web-server.image.repository="gcr.io/$GCLOUD_PROJECT/data61" --set web-server.image.tag=$TAG --set gateway.image.repository="gcr.io/$GCLOUD_PROJECT/data61" --set gateway.image.tag=$TAG -f $HELM_CONFIG_FILE