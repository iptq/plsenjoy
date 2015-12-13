var async = require("async");
var common = require("./common");
var moment = require("moment");
var request = require("request");
var user = require("./user");

exports.get_map_data = function(beatmapid, callback) {
	common.db.collection("mapcache").find({
		b: beatmapid,
		expire: { $gt: ~~(moment().format("X")) }
	}).toArray(function(err, doc) {
		if (doc.length != 1) {
			request.get("https://osu.ppy.sh/api/get_beatmaps?k=" + process.env.OSU_APIKEY + "&b=" + beatmapid, function(error, response, body) {
				var data = JSON.parse(body)[0];
				var mapdoc = {
					b: ~~(data["beatmap_id"]),
					s: ~~(data["beatmapset_id"]),
					bpm: ~~(data["bpm"]),
					mapper: data["creator"],
					stars: parseFloat(data["difficultyrating"]),
					cs: ~~(data["diff_size"]),
					od: ~~(data["diff_overall"]),
					ar: ~~(data["diff_approach"]),
					artist: data["artist"],
					title: data["title"],
					difficulty: data["version"],
					length: ~~(data["total_length"]),
					maxcombo: ~~(data["max_combo"]),
					expire: ~~(moment().add(8, "days").format("X")),
				};
				common.db.collection("mapcache").update({
					b: mapdoc["b"]
				}, {
					$set: mapdoc
				}, {
					upsert: true
				}, function() {
					callback(mapdoc);
				});
			});
		} else {
			var mapdoc = doc[0];
			delete mapdoc["_id"];
			callback(mapdoc);
		}
	});
};

exports.get_mappool = function(callback) {
	var stages = {
		"Group Stage": {
			NoMod: [
				230523, 516452, 655257, 211732, 225301, 255141
			],
			Hidden: [
				255323, 687865, 296435
			],
			HardRock: [
				535808, 794551, 296435
			],
			DoubleTime: [
				443272, 226667, 413446
			],
			Tiebreaker: [
				734910
			]
		}
	};
	var mapdata = { };
	async.each(Object.keys(stages), function(stage, callback3) {
		// console.log(stage);
		var stagedata = { };
		var maps = stages[stage];
		async.each(Object.keys(maps), function(category, callback1) {
			// console.log(" " + category);
			var beatmaps = maps[category];
			var data = [ ];
			async.each(beatmaps, function(bid, callback2) {
				// console.log("  " + bid);
				exports.get_map_data(bid, function(beatmapdata) {
					user.get_user_data(beatmapdata["mapper"], function(mapperdata) {
						beatmapdata["mapper"] = mapperdata;
						data.push(beatmapdata);
						callback2();
					});
				});
			}, function() {
				stagedata[category] = data;
				callback1();
			});
		}, function() {
			mapdata[stage] = stagedata;
			callback3();
		});
	}, function() {
		var obj = { maps: mapdata };
		callback(obj);
	});
};