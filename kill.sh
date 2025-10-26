lsof -ti:8080 | xargs kill -9 2>/dev/null || true
#kill -9 $(lsof -i -N -P  | grep :8080 | awk '{ print $2 }' | uniq)
