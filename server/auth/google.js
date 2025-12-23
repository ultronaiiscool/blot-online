const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;

module.exports = function initGoogleAuth(app){
  if(!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET){
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in server/.env");
  }

  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
  }, (accessToken, refreshToken, profile, done)=>{
    done(null,{
      id: profile.id,
      name: profile.displayName,
      avatar: profile.photos?.[0]?.value || null
    });
  }));

  passport.serializeUser((u,d)=>d(null,u));
  passport.deserializeUser((u,d)=>d(null,u));

  app.get("/auth/google", passport.authenticate("google",{scope:["profile"]}));
  app.get("/auth/google/callback",
    passport.authenticate("google",{failureRedirect:"/"}),
    (req,res)=>res.redirect("/")
  );

  app.get("/logout",(req,res)=>req.logout(()=>res.redirect("/")));
};
