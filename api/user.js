var bcrypt = require("bcrypt");
var common = require("./common");
var moment = require("moment");
var net = require("net");
var request = require("request");
var validator = require("validator");

var get_user_ip = function(req) {
	return (req.headers["x-forwarded-for"] || "").split(",")[0] || req.connection.remoteAddress;
};

exports.people = [
	"ioexception", "kardshark", "megatron is bad", "megatron", "tironas"
];

exports.get_user_data = function(username, callback) {
	common.db.collection("usercache").find({
		username_lower: username.toLowerCase()
	}).toArray(function(err, doc) {
		if (doc.length != 1 || doc[0].expire > ~~(moment().format("X"))) {
			request.get("https://osu.ppy.sh/api/get_user?k=" + process.env.OSU_APIKEY + "&u=" + username, function(error, response, body) {
				var result = JSON.parse(body);
				if (result.length != 1) {
					callback({ });
				} else {
					var data = result[0];
					var userdoc = {
						osuid: ~~(data["user_id"]),
						rank: ~~(data["pp_rank"]),
						country_rank: ~~(data["pp_country_rank"]),
						playcount: ~~(data["playcount"]),
						accuracy: parseFloat(data["accuracy"]),
						country: data["country"],
						expire: ~~(moment().add(8, "hours").format("X")),
						username: data["username"],
						username_lower: data["username"].toLowerCase()
					};
					if ("team" in doc) {
						userdoc["team"] = doc["team"];
					}
					common.db.collection("usercache").update({
						osuid: userdoc["osuid"]
					}, {
						$set: userdoc
					}, {
						upsert: true
					}, function() {
						callback(userdoc);
					});
				}
			});
		} else {
			var userdoc = doc[0];
			delete userdoc["_id"];
			callback(userdoc);
		}
	});
};

exports.login = function(req, res) {
	var email = req.body.email;
	var password = req.body.password;
	
	if (!(email && email.length > 0 && password && password.length > 0)) {
		return res.send({ success: 0, message: "Please fill out all the fields." });
	}
	
	login_user(req, email, password, function(result) {
		if (result.success == 1 && "sid" in result) {
			res.cookie("sid", result.sid, { signed: true });
			res.cookie("email", unescape(email), { signed: true });
			res.cookie("username", result.username, { signed: true });
		}
		res.send(result);
	});
};

exports.logout = function(req, res) {
	common.db.collection("tokens").update({
		type: "login",
		sid: req.signedCookies["sid"],
	}, {
		$set: {
			expired: true,
			expireTime: ~~(moment().format("X"))
		}
	}, function() {
		res.clearCookie("sid", { signed: true });
		res.clearCookie("email", { signed: true });
		req.session.destroy();
		res.redirect("/");
	});
};

exports.register = function(req, res) {
	var username = req.body.username;
	var email = req.body.email;
	var password = req.body.password;
	var recaptcha = req.body.recaptcha;
	
	if (!(username && username.length && email && email.length > 0 && password && password.length > 0)) {
		return res.send({ success: 0, message: "Please fill out all the fields." });
	}
	
	console.log(username.toLowerCase());
	if (!(~~(moment().format("X")) > 1449993600 || exports.people.indexOf(username.toLowerCase()) >= 0)) {
		return res.send({ success: 0, message: "Registration not open yet." });
	}
	
	if (!validator.isEmail(email)) {
		return res.send({ success: 0, message: "That doesn't look like an email to me!" });
	}
	
	request.post(
		"https://www.google.com/recaptcha/api/siteverify",
		{ form: {
			secret: process.env.RECAPTCHA_SECRET,
			response: recaptcha,
			remoteip: get_user_ip(req)
		} },
		function (error, response, body) {
			if (true) { // !error && response.statusCode == 200 && JSON.parse(body)["success"] == true) {
				common.db.collection("users").find({
					email: email
				}).count(function(err, count) {
					if (err) { return res.send({ success: 0, message: "Internal error (1)." }); }
					if (count != 0) {
						return res.send ({ success: 0, message: "Someone's already registered this email." });
					} else {
						common.db.collection("users").find({
							username_lower: username.toLowerCase()
						}).count(function(err3, existing) {
							if (existing != 0) {
								return res.send({ success: 0, message: "Someone's already registered this username." });
							}
							exports.get_user_data(username, function(userdata) {
								// console.log(userdata);
								var rank = userdata["rank"];
								if (!(rank >= 1000 && rank <= 20000)) {
									return res.send({ success: 0, message: "Your rank must be between 1,000 and 20,000 to register for this tournament." });
								}
								var uid = common.token();
								var salt = bcrypt.genSaltSync(10);
								var phash = bcrypt.hashSync(password, salt);
								var teamname = "Team " + common.token(8);
								var doc = {
									uid: uid,
									osuid: userdata["osuid"],
									teamname: teamname,
									teamname_lower: teamname.toLowerCase(),
									username: userdata["username"],
									username_lower: userdata["username"].toLowerCase(),
									email: email.toLowerCase(),
									password: phash,
									timestamp: ~~(moment().format("X")),
									team_members: [ ],
								}
								common.db.collection("users").insert(doc, { w: 1 }, function(err2, doc) {
									if (err2) { return res.send({ success: 0, message: "Internal error (2)." }); }
									exports.send_verification(email, function(mail_success) {
										if (mail_success) {
											login_user(req, email, password, function(result) {
												if (result.success == 1 && "sid" in result) {
													res.cookie("sid", result.sid, { signed: true });
													res.cookie("email", unescape(email), { signed: true });
												}
												return res.send({ success: 1, message: "Registered!" });
											});
										} else {
											return res.send({ success: 0, message: "Failed to send verification email." });
										}
									});
								});
							});
						});
					}
				});
			} else {
				return res.send({ success: 0, message: "Please do the captcha." });
			}
		}
	);
};

exports.verify_osu = function(req, res) {
	var code = req.params.code;
	if (!(code && code.length > 0)) {
		return res.send({ success: 0, message: "Code is missing or broken (1)." });
	}
	common.db.collection("users").update({
		osu_verify_code: code
	}, {
		$set: { osu_verified: true },
		$unset: { osu_verify_code: "" },
	}, function(err, result) {
		if (err) { console.log(err); return res.send({ success: 0, message: "Internal error (10)." }); }
		// console.log(result["result"]["nModified"]);
		if (result["result"]["nModified"] != 1) {
			return res.send({ success: 0, message: "Code is missing or broken (2)." });
		} else {
			res.redirect("/verified");
		}
	});
};

exports.verify_email = function(req, res) {
	var code = req.params.code;
	if (!(code && code.length > 0)) {
		return res.send({ success: 0, message: "Code is missing or broken (1)." });
	}
	common.db.collection("users").update({
		verify_code: code
	}, {
		$set: { email_verified: true },
		$unset: { verify_code: "" },
	}, function(err, result) {
		if (err) { console.log(err); return res.send({ success: 0, message: "Internal error (10)." }); }
		// console.log(result["result"]["nModified"]);
		if (result["result"]["nModified"] != 1) {
			return res.send({ success: 0, message: "Code is missing or broken (2)." });
		} else {
			res.redirect("/verified");
		}
	});
};

exports.send_osu_verification = function(username, callback) {
	common.db.collection("users").find({
		username_lower: username.toLowerCase()
	}).toArray(function(err, users) {
		if (err) { console.log(err); }
		if (users.length != 1) { return callback(false); }
		var user_info = users[0];
		var verify_code = common.token();
		var url = "http://" + common.DOMAIN + "/api/verify_osu/" + verify_code;
		var client = new net.Socket();
		var message = "Hi there! To confirm your pls enjoy tournament account, click [" + url + " this link].";
		client.connect(6667, "irc.ppy.sh", function() {
			console.log("Connected.");
			client.write("PASS " + process.env.OSU_IRCKEY + "\n");
			client.write("NICK IOException\n");
			client.on("data", function(data) {
				// console.log("[SERVER] " + data);
				if (data.indexOf("Welcome to the osu!Bancho.") != -1) {
					client.write("PRIVMSG " + username.replace(/\W+/g, "_") + " :" + message + "\n");
					client.destroy();
					var doc = {
						osu_verified: false,
						osu_verify_code: verify_code,
					}
					common.db.collection("users").update({
						username_lower: username.toLowerCase(),
					}, { $set: doc }, function(err2, doc) {
						if (err2) { callback(false); }
						return callback(true);
					});
				}
			});
		});
	});
};

exports.send_verification = function(email, callback) {
	common.db.collection("users").find({
		email: email
	}).toArray(function(err, users) {
		if (err) { console.log(err); }
		if (users.length != 1) { return callback(false); }
		var user_info = users[0];
		var verify_code = common.token();
		var url = "http://" + common.DOMAIN + "/api/verify_email/" + verify_code;
		request.post({
				url: "https://api.sendgrid.com/api/mail.send.json",
				headers: {
					Authorization: "Bearer " + process.env.SENDGRID_APIKEY
				},
				form: {
					to: user_info["email"],
					from: common.EMAIL,
					subject: "[ACTION REQUIRED] pls enjoy tournament - Please verify your email.",
					html: "<h1>Welcome to pls enjoy tournament</h1> <p>We're super excited to have you on board our new platform. We're still in beta, so feel free to play around and give us feedback! Click the following link to verify your email.</p> <p><a href=\"" + url + "\">" + url + "</a></p> <p>Cheers,<br />IOException</p> <p>&nbsp;</p>"
				},
			}, function(error, response, body) {
				if (error) console.log("error = " + error);
				var doc = {
					email_verified: false,
					verify_code: verify_code,
				}
				common.db.collection("users").update({
					email: email,
				}, { $set: doc }, function(err2, doc) {
					if (err2) { callback(false); }
					return callback(true);
				});
			}
		);
	});
};

exports.resend_osu_verification = function(req, res) {
	common.is_logged_in(req, function(logged_in) {
		if (logged_in) {
			common.db.collection("users").find({
				email: req.signedCookies["email"]
			}).toArray(function(err, users) {
				if (users.length != 1) { return res.send({ success: 0, message: "You're not logged in." }); }
				var user_info = users[0];
				exports.send_osu_verification(user_info["username"], function(success) {
					if (success) {
						return res.send({ success: 1, message: "Check your private messages!" });
					} else {
						return res.send({ success: 0, message: "Failed." });
					}
				});
			});
		}
	});
};

exports.resend_verification = function(req, res) {
	common.is_logged_in(req, function(logged_in) {
		if (logged_in) {
			common.db.collection("users").find({
				email: req.signedCookies["email"]
			}).toArray(function(err, users) {
				if (users.length != 1) { return res.send({ success: 0, message: "You're not logged in." }); }
				var user_info = users[0];
				exports.send_verification(user_info["email"], function(mail_success) {
					if (mail_success) {
						return res.send({ success: 1, message: "Resent!" });
					} else {
						return res.send({ success: 0, message: "Failed." });
					}
				});
			});
		}
	});
};

exports.forgot = function(req, res) { // this is the structure for a function that handles requests
						// so if a user makes a request to /api/user/forgot, this function will handle the request (the variable req)
						// and then can return stuff via the response (res variable)
	// so the first thing i'm going to do is retrieve the email that was entered into the box
	// you don't need to login to request a new password so i'll just skip the login checking part
	var email = req.body.email; // the variable email comes from email: email we put in the js part
								// req.body is a expressJS variable that just contains all of the parameters that were passed
								// since email is one of them i can access it from here
	if (!(email && email.length > 0 && validator.isEmail(email))) { // this checks if
																	// 1. the email does in fact exist
																	// 2. the email's length > 0
																	// 3. the email is a valid email
																// validator is a separate library that i installed
		// if it's not:
		return res.send({ success: 0, message: "Invalid email." });
		// the return is important because it stops the execution of the function right here.
	}
	// get rid of all active tickets
	common.db.collection("forgot_password").update({
		// this is how you query from the database
		email: email.toLowerCase()
		// since mongo doesn't have case insensitive searching, i'm just going to make all the emails lowercase
		// so it's easier to compare, rather than writing my own comparison function
	}, {
		$set: { active: false }
	}, function(err) { //<-- this converts the query (known as a Cursor) to an actual array of things
									// err contains an error if it exists. you're technically supposed to catch this but w/e
		if (err) { return res.send({ success: 0, message: "Internal error." }); } // this is so your program doesn't crash
		// then docs contains the actual documents that were returned by the query
		// since it's an array, let's check if the email matched a user
		var code = common.token();
		// this generates a code :P common.token is a function i wrote to generate a random string
		var ticket = {
			email: email.toLowerCase(), // again this is to make it easier to compare
			expires: ~~(moment().add(2, "hours").format("X")), //expiration time for code
			code: code,/// the code of course
			active: true
		}; // do u know how dicts work? this is basically a dict
		common.db.collection("forgot_password").insert(ticket, function() {
			// ok i need to send the email rn
			// so i'm going to use the sendgrid api. i've already got it basiclaly set up above, so i'll just copypasta
			var url = "http://" + common.DOMAIN + "/recover#" + code;
			request.post({ //request is a library that, well, makes requests
				url: "https://api.sendgrid.com/api/mail.send.json",
				headers: {
					Authorization: "Bearer " + process.env.SENDGRID_APIKEY // to hide the actual api key when i'm pushing to open source (http://github.com/failedxyz/plsenjoy)
				},
				form: {
					to: email,
					from: common.EMAIL, // this is just a static variable
					subject: "Password Recovery Request for pls enjoy tournament",
					html: "<h1>Forgot Password</h1> <p>Someone requested a password recovery for this email on <b>pls enjoy tournament</b>. Click the following link to reset your password:</p> <p><a href=\"" + url + "\">" + url + "</a></p> <p>Cheers,<br />IOException</p>"
				},
				}, function(error, response, body) {
					if (error) { console.log("error = " + error); return res.send({ success: 0, message: "Internal error." }); }
					return res.send({ success: 1, message: "An email with a password recovery code was sent to the email you supplied." }); // o wait i need to actually send the email
				}
			);
		});
	});
};

exports.recover = function(req, res) {
	var code = req.body.code;
	var password = req.body.password;
	var password2 = req.body.password2;
	
	if (!(code && code.length > 0
			&& password && password.length > 3
			&& password2 && (password2 == password))) {
		return res.send({ success: 0, message: "Please fill out all the fields, and make sure your passwords match." });
	}
	
	common.db.collection("forgot_password").find({
		code: code
	}).toArray(function(err, doc) {
		if (err) { return res.send({ success: 0, message: "Internal error." }); }
		if (doc.length != 1) { return res.send({ success: 0, message: "Code isn't valid." }); }
		var ticket = doc[0];
		if (!(ticket["active"] == true && ~~(moment().format("X")) < ticket["expires"])) { return res.send({ success: 0, message: "Code isn't valid." }); }
		// moment is a library that i used for time. i used it above too; http://momentjs.com/
		common.db.collection("users").find({
			email: ticket["email"]
		}).toArray(function(err2, doc2) {
			if (err2) { return res.send({ success: 0, message: "Internal error." }); }
			if (doc2.length != 1) { return res.send({ success: 0, message: "No user found for this code." }); }
			var user = doc2[0];
			var salt = bcrypt.genSaltSync(10);
			var phash = bcrypt.hashSync(password, salt);
			common.db.collection("users").update({
				email: ticket["email"]
			}, {
				$set: { password: phash }
			}, function() {
				common.db.collection("forgot_password").remove({
					email: ticket["email"]
				}, function() {
					return res.send({ success: 1, message: "Successfully updated your password!" });
				});
			});
		});
	});
};

var login_user = function(req, email, password, callback) {
	common.db.collection("users").find({
		email: email
	}).toArray(function(err, users) {
		if (err) { return callback({ success: 0, message: "Internal error (3)." }); }
		if (users.length != 1) {
			return callback({ success: 0, message: "Please check if your email and password are correct." });
		} else {
			var user = users[0];
			var correct = bcrypt.compareSync(password, user["password"]);
			if (correct) {
				var sid = common.token();
				var session_information = {
					type: "login",
					uid: user["uid"],
					sid: sid,
					created: ~~(moment().format("X")),
					expired: false,
					ua: req.headers["user-agent"],
					ip: get_user_ip(req)
				};
				common.db.collection("tokens").insert(session_information, { w: 1 }, function(err2, doc) {
					if (err2) { return callback({ success: 0, message: "Internal error (4)." }); }
					return callback({ success: 1, message: "Successfully logged in.", sid: sid, username: user["username"] });
				});
			} else {
				return callback({ success: 0, message: "Please check if your email and password are correct." });
			}
		}
	});
};