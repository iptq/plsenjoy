var async = require("async");
var common = require("./common");
var moment = require("moment");
var request = require("request");
var user = require("./user");

var format_time = function(seconds) {
	var minutes = Math.floor(seconds / 60);
	seconds %= 60;
	if (seconds < 10) {
		seconds = "0" + seconds;
	}
	return minutes + ":" + seconds;
}

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
				535808, 794551, 120080
			],
			DoubleTime: [
				443272, 226667, 413446
			],
			FreeMod: [
				460360, 169450, 315356
			],
			Tiebreaker: [
				734910
			]
		},
		"Round of 16": {
			NoMod: [
				270363, 828940, 830164, 282251, 192320, 129961
			],
			Hidden: [
				140821, 371325, 369938
			],
			HardRock: [
				244182, 539884, 688305
			],
			DoubleTime: [
				694701, 361011, 295857
			],
			FreeMod: [
				730027, 261725, 290581
			],
			Tiebreaker: [
				721158
			]
		},
		"Round of 8": {
			NoMod: [
				462678, 689775, 798331, 559611, 807482, 644067
			],
			Hidden: [
				740692, 558509, 391182
			],
			HardRock: [
				673787, 485125, 705760
			],
			DoubleTime: [
				580225, 210353, 674518
			],
			FreeMod: [
				548471, 211889, 320098
			],
			Tiebreaker: [
				817623, 735021, 678340
			]
		}
	};
	var downloads = {
		"Group Stage": "https://mega.nz/#!UJdT3Sya!V88wx5bJhCKnIpAOiF7Ayb2Uo9CiIff_EklzwrJViKE",
		"Round of 16": "https://mega.nz/#!I8dEnSDZ!YR628sPfm44WJXeO_s9hsM2NbjGgeUAelcOSTmRgt7U",
		"Round of 8": "https://mega.nz/#!Mx9AGIJZ!avqbWQD8cAVlm9AC_HqChvwG1QnYhkP84DKBUQzGaTg"
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
						beatmapdata["length_fmt"] = format_time(beatmapdata["length"]);
						beatmapdata["stars"] = Math.round(beatmapdata["stars"] * 100) / 100;
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
		var obj = { maps: mapdata, downloads: downloads };
		callback(obj);
	});
};