var async = require("async");
var common = require("./common");
var request = require("request");
var team = require("./team");
var user = require("./user");

var api = { };

api.route = function(app) {
	app.post("/api/user/login", user.login);
	app.get("/logout", user.logout);
	app.post("/api/user/register", user.register);
	app.post("/api/user/resend_osu_verification", user.resend_osu_verification);
	app.post("/api/user/resend_verification", user.resend_verification);
	app.post("/api/user/forgot", user.forgot); // <-- notice i added an endpoint
	app.post("/api/user/recover", user.recover); // <-- notice i added an endpoint
	app.get("/api/verify_osu/:code", user.verify_osu);
	app.get("/api/verify_email/:code", user.verify_email);
	app.post("/api/team/add_member", team.add_member);
	app.post("/api/team/delete_member", team.delete_member);
	app.post("/api/team/rename", team.rename);
};

api.compute_status = function(team_members, callback) {
	if (team_members.length < 2) {
		return { status: "Not enough members.", color: "warning" };
	} else {
		for(var i=0; i<team_members.length; i++) {
			var rank = team_members[i].rank;
			if (!(rank >= 900 && rank <= 21000)) {
				return { status: team_members[i].username + " is out of range.", color: "danger" };
			}
		}
	}
	// just for testing
	return { status: "Awaiting approval.", color: "warning" };
};

// assuming user is logged in
api.user_info = function(email, callback) {
	common.db.collection("users").find({
		email: email
	}).toArray(function(err, users) {
		if (err) { return callback({ message: "Internal error (5)." }); }
		if (users.length != 1) {
			return callback({ message: "Internal error (6)." });
		} else {
			var userdoc = users[0];
			var userobj = {
				uid: userdoc["uid"],
				osuid: userdoc["osuid"],
				username: userdoc["username"],
				firstname: userdoc["firstname"],
				lastname: userdoc["lastname"],
				email: userdoc["email"],
				email_md5: common.hash("md5", email),
				teamname: userdoc["teamname"],
				email_verified: userdoc["email_verified"] || false,
				osu_verified: userdoc["osu_verified"] || false,
			};
			var team_member_usernames = [ userdoc["username"] ];
			if ("team_members" in userdoc && userdoc["team_members"].length > 0) {
				for(var i=0; i<userdoc["team_members"].length; i++) {
					team_member_usernames.push(userdoc["team_members"][i]);
				}
			}
			var team_members = [ ];
			async.each(team_member_usernames, function(member, callback1) {
				user.get_user_data(member, function(data) {
					data["captain"] = member == userdoc["username"];
					team_members.push(data);
					callback1();
				});
			}, function(err) {
				team_members.sort(function(a, b) {
					if (a["captain"]) return -1;
					if (b["captain"]) return 1;
					return (a.name > b.name ? -1 : 1);
				});
				userobj["status"] = api.compute_status(team_members);
				userobj["team_members"] = team_members;
				return callback(userobj);
			});
		}
	});
}

module.exports = api;