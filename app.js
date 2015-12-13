Error.stackTraceLimit = Infinity;

var api = require("./api/api");
var bodyParser = require("body-parser");
var common = require("./api/common");
var cookieParser = require("cookie-parser");
var csurf = require("csurf");
var express = require("express");
var minify = require("express-minify");
var path = require("path");
var session = require("express-session");

var app = express();

app.set("views", path.join(__dirname, "views/pages"));
app.set("view engine", "ejs");

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(session({
	name: "plsenjoy.session",
	resave: false,
	saveUninitialized: true,
	secret: process.env.SESSION_SECRET,
	cookie: {
		secure: true
	}
}));

app.use(minify());

api.route(app);
app.use(csurf());

app.use("/", express.static("web"));

require("./router")(app);

app.use(function (err, req, res, next) {
	if (err.code !== "EBADCSRFTOKEN") return next(err)
	
	res.status(403)
	res.send("form tampered with")
})

app.use(function(req, res, next) {
	var err = new Error("Not Found");
	err.status = 404;
	
	var vars = { };
	common.is_logged_in(req, function(logged_in) {
		if (logged_in) {
			api.user_info(req.signedCookies["email"], function(user_info) {
				vars.extend_object({ user_info: user_info, logged_in: logged_in });
				res.render("404", { page: vars.extend_object({ title: "404" }) });
			});
		} else {
			vars.extend_object({ logged_in: logged_in });
			res.render("404", { page: vars.extend_object({ title: "404" }) });
		}
	});
});

module.exports = app;

var port = process.env.PORT || 3000;
app.listen(port);
console.log("Listening on port " + port + "...");