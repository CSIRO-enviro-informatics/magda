#!/bin/bash
echo ""
echo ""
echo "Authenticating and Connecting to the Cluster"
echo ""
echo ""

gcloud auth activate-service-account kn-dev-robot@knowledge-network-192205.iam.gserviceaccount.com --key-file=/secrets/kn-dev-robot.json
gcloud container clusters get-credentials kn-dev-cluster-1 --zone australia-southeast1-a --project knowledge-network-192205

kubectl config set-context $(kubectl config current-context) --namespace=$NAMESPACE

chmod 755 *.sh
echo ""
echo ""
echo "Initializing Helm"
echo ""
echo ""

helm init --upgrade
