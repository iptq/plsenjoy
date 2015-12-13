var api = require("./api");
var async = require("async");
var common = require("./common");
var request = require("request");
var user = require("./user");

exports.add_member = function(req, res) {
	common.is_logged_in(req, function(logged_in) {
		if (logged_in) {
			common.db.collection("users").find({
				email: req.signedCookies["email"]
			}).toArray(function(err, users) {
				if (users.length != 1) { return res.send({ success: 0, message: "You're not logged in." }); }
				var user_info = users[0];
				if ("team_members" in user_info && user_info["team_members"].length == 2) {
					return res.send({ success: 0, message: "You already have the maximum number of people on your team!" });
				}
				
				var username = req.body.username;
				if (!(username && username.length > 0)) {
					return res.send({ success: 0, message: "Please enter a username." });
				}
				
				user_info.team_members.push(user_info.username_lower);
				for(var i=0; i<user_info["team_members"].length; i++) {
					if (user_info["team_members"][i] == username.toLowerCase())
						return res.send({ success: 0, message: "That user is already a member of this team!" });
				}
				
				user.get_user_data(username, function(data) {
					var rank = data["rank"];
					if (!("osuid" in data)) {
						return res.send({ success: 0, message: "That user doesn't exist!" });
					}
					if (!(rank >= 1000 && rank <= 20000)) {
						return res.send({ success: 0, message: username + "'s rank must be between 1,000 and 20,000 to be able to join this tournament." });
					}
					// any other checks?
					common.db.collection("users").update({
						email: req.signedCookies["email"]
					}, {
						$push: {
							team_members: data["username"].toLowerCase()
						}
					}, function() {
						return res.send({ success: 1, message: "Successfully added!" });
					});
				});
			});
		} else {
			return res.send({ success: 0, message: "You must be logged in to perform this action!" });
		}
	});
};

exports.delete_member = function(req, res) {
	common.is_logged_in(req, function(logged_in) {
		if (logged_in) {
			common.db.collection("users").find({
				email: req.signedCookies["email"]
			}).toArray(function(err, users) {
				if (users.length != 1) { return res.send({ success: 0, message: "You're not logged in." }); }
				var user_info = users[0];
				var found = false;
				var username = req.body.username;
				if (!(username && username.length > 0)) {
					return res.send({ success: 0, message: "Please provide a username." });
				}
				if ("team_members" in user_info) {
					for(var i=0; i<user_info["team_members"].length; i++) {
						if (user_info["team_members"][i].toLowerCase() == username.toLowerCase()) {
							found = true;
							break;
						}
					}
				}
				if (!found) {
					return res.send({ success: 0, message: "This member was not found." });
				}
				
				common.db.collection("users").update({
					email: req.signedCookies["email"]
				}, {
					$pull: {
						team_members: username.toLowerCase()
					}
				}, function() {
					return res.send({ success: 1, message: "Successfully removed!" });
				});
			});
		} else {
			return res.send({ success: 0, message: "You must be logged in to perform this action!" });
		}
	});
};

exports.rename = function(req, res) {
	common.is_logged_in(req, function(logged_in) {
		if (logged_in) {
			common.db.collection("users").find({
				email: req.signedCookies["email"]
			}).toArray(function(err, users) {
				if (users.length != 1) { return res.send({ success: 0, message: "You're not logged in." }); }
				var user_info = users[0];
				
				var newname = req.body.newname;
				newname = newname.replace("\n", "");
				
				if (!(newname && newname.length > 0)) {
					return res.send({ success: 0, message: "Please enter a team name." });
				}
				if (newname.length > 20) {
					return res.send({ success: 0, message: "Team names must be less than 20 characters long." });
				}
				
				common.db.collection("users").count({
					teamname_lower: newname.toLowerCase(),
					uid: { $ne: user_info["uid"] }
				}, function(err, count) {
					if (count > 0) {
						return res.send({ success: 0, message: "This name is taken." });
					}
					common.db.collection("users").update({
						email: req.signedCookies["email"]
					}, {
						$set: {
							teamname: newname,
							teamname_lower: newname.toLowerCase()
						}
					}, function() {
						return res.send({ success: 1, message: "Changed." });
					});
				});
			});
		} else {
			return res.send({ success: 0, message: "You must be logged in to perform this action!" });
		}
	});
};

exports.get_all_teams = function(callback) {
	var teams = [ ];
	common.db.collection("users").find({  }).toArray(function(err, docs) {
		async.each(docs, function(doc, callback1) {
			if (doc.team_members.length < 1) {
				callback1();
			} else {
				var members = [ doc.username ];
				var team = doc;
				var teammembers = [ ];
				for(var j=0; j<doc.team_members.length; j++) {
					members.push(doc.team_members[j]);
				}
				async.each(members, function(member, callback2) {
					user.get_user_data(member, function(userdata) {
						delete userdata["expire"];
						userdata["captain"] = userdata["username_lower"] == team["captain"].toLowerCase();
						teammembers.push(userdata);
						callback2();
					});
				}, function() {
					teammembers.sort(function(a, b) {
						if (a["captain"]) return -1;
						if (b["captain"]) return 1;
						return (a.rank > b.rank ? -1 : 1);
					});
					var xteam = { };
					xteam["teamname"] = team["teamname"];
					xteam["timestamp"] = team["timestamp"];
					xteam["members"] = teammembers;
					var avgrank = 0.0;
					for(var i=0; i<teammembers.length; i++) {
						avgrank += teammembers[i].rank;
					}
					avgrank /= 1.0 * teammembers.length;;
					xteam["avgrank"] = avgrank;
					teams.push(xteam);
					callback1();
				});
			}
		}, function() {
			teams.sort(function(a, b) {
				return a["timestamp"] - b["timestamp"];
			});
			callback(teams);
		})/*
		for(var i=0; i<docs.length; i++) {
			var members = [ docs[i].username ];
			for(var j=0; j<docs[i].team_members.length; j++) {
				members.push(docs[i].team_members[j]);
			}
			var doc = {
				teamname: docs[i].teamname,
				members: members
			};
			teams.push(doc);
		}
		callback(teams);
		*/
	});
};