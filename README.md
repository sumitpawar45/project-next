# WatchNext: go live (free)

Folder layout (keep exactly this):
  index.html
  api/movies.js

1. TMDB key: themoviedb.org -> sign up -> Settings -> API -> request a Developer key
   (personal / learning project). Copy the "API Key" (the short one).
2. GitHub: create a repository and upload index.html and the api folder.
3. Vercel: vercel.com -> sign in with GitHub -> Add New Project -> pick the repo -> Deploy.
4. Vercel project -> Settings -> Environment Variables:
     Name: TMDB_KEY    Value: (your key)    -> Save
   Then Deployments -> Redeploy.
5. Open your Vercel link. You should see real movies and posters.

Notes
- Opening index.html directly from your computer shows the 22 demo movies (no server there). That is expected.
- Do not put the key inside index.html.
