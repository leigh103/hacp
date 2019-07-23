const WebSocket = require('ws')
const request = require('request')
const fs = require('fs')
const moment = require('moment-timezone')
const nodemailer = require('nodemailer');
const async = require('async')
const hacp = require('./hacp.js');

module.exports = {

    init(scope, callback) {

        fs.readFile('./settings.json', function read(err, data) {
            if (err) {throw err;}
            scope.settings = JSON.parse(data);

            fs.readFile('./automations.json', function read(err, data) {

                if (err) {throw err;}

                if (data.length > 0){
                    scope.automations = JSON.parse(data);
                } else {
                    scope.automations = {};
                }

                fs.readFile('./devices.json', function read(err, data) {

                    if (err) {throw err;}

                    if (data.length > 0){
                        scope.devices = JSON.parse(data);
                    } else {
                        scope.devices = {};
                    }

                    fs.readFile('./alarm.json', function read(err, data) {

                        if (err) {throw err;}

                        if (data.length > 0){
                            scope.alarm = JSON.parse(data);
                        } else {
                            scope.alarm = {};
                        }

                        request({
                            method: 'GET',
                            url:'http://'+scope.settings.host+'/api/'+scope.settings.api_key
                        }, (error, request, body) => {

                            if (typeof body == 'string' && body.length>0){
                                body = JSON.parse(body)
                            } else {
                                body = {}
                            }


                            scope.groups = body.groups
                            scope.lights = body.lights
                            scope.sensors = body.sensors

                            if (scope.sensors[1] && scope.sensors[1].state && scope.sensors[1].state.status) { // set the time.sunset state if it doesn't exist
                                if (parseInt(scope.sensors[1].state.status) >= 180){
                                    scope.time.sunset = true
                                } else if (parseInt(scope.sensors[1].state.status) >= 140 && parseInt(scope.sensors[1].state.status) < 180) {
                                    scope.time.sunset = false
                                }
                            }

                            if (callback){
                                if (body.length>0 && body[0].description){
                                    callback(body[0].description)
                                } else {
                                    callback(scope)
                                }
                            }

                        }) // API call

                    }) // alarm

                }) // devices

            }) // automations

        }) // settings

    },

    alarmState(scope, set, key, chk_devices){

        var all_away = true
        var cnt = 1

        if (chk_devices){ // check for device presence to auto set the alarm

            for (var i in scope.devices){

                if (scope.devices[i].present === true && scope.devices[i].is_master === true){
                    all_away = false
                }

                if (cnt >= Object.keys(scope.devices).length){

                    if (all_away === true){

                        if (set === true && scope.alarm.armed === false){ // don't set the alarm if it's already set

                            scope.alarm.all_away = true
                            module.exports.setAlarm(key, scope)
                            module.exports.checkAutomation(scope, 'all_devices', 'away')
                            scope.emit('alarm',scope.alarm)

                        } else {

                            scope.alarm.setting = moment().tz(scope.settings.timezone).add(2,'m')

                            if (!scope.timers.devices){
                                scope.timers.devices = setTimeout(function(){ // wait 2 mins before setting the alarm
                                    module.exports.alarmState(scope, true, key, true)
                                },120000)
                            }

                            scope.emit('alarm',scope.alarm)
                            hacp.save('alarm',scope)

                        }

                    } else {

                        if (scope.timers.devices){
                            clearTimeout(scope.timers.devices)
                        }
                        module.exports.setAlarm(false, scope)
                        scope.emit('devices','false','all_away')
                    }

                } else {

                    cnt++

                }

            }

        } else if (set === true && !chk_devices) { // force set/unset the alarm

            module.exports.setAlarm(key, scope)

        }
    },

    setAlarm(key, scope){

        if (scope.alarm.triggered){
            scope.alarm.last_triggered = scope.alarm.triggered
        }

        if (key !== false){

            if (scope.alarm.armed === false){
                scope.alarm.setting = false
                scope.alarm.armed = true
                scope.alarm.key = key
                scope.alarm.sensors = scope.alarm.alarms[key].sensors
            } else {
                scope.alarm.setting = false
                scope.alarm.armed = false
                scope.alarm.triggered = false
                scope.alarm.key = false
                scope.alarm.sensors = []
            }

        } else {

            scope.alarm.setting = false
            scope.alarm.armed = false
            scope.alarm.all_away = false
            scope.alarm.triggered = false
            scope.alarm.key = false
            scope.alarm.sensors = []

        }

        scope.emit('alarm',scope.alarm)
        hacp.save('alarm',scope)

    },

    getCamImages(scope, alarm){

        if (alarm === true && scope.alarm.key >= 0 && scope.alarm.alarms[scope.alarm.key] && scope.alarm.alarms[scope.alarm.key].cameras.length > 0){

            scope.alarm.html = "<b>"+scope.alarm.alarms[scope.alarm.key].name+" has been triggered</b><br><br>";
            let iterations = scope.alarm.alarms[scope.alarm.key].cameras.length;
            let s_iterations = scope.alarm.sensors.length;

            for (const sensor of scope.alarm.sensors) {

                if (scope.sensors[sensor].state && typeof scope.sensors[sensor].state.presence != 'undefined'){
                    scope.alarm.html += '<b>'+scope.sensors[sensor].name+'</b><br>Motion: '+scope.sensors[sensor].state.presence+'<br>Last Update: '+scope.sensors[sensor].state.lastupdated+'<br><br>'
                }
                if (scope.sensors[sensor].state && typeof scope.sensors[sensor].state.open != 'undefined'){
                    scope.alarm.html += '<b>'+scope.sensors[sensor].name+':</b><br>Door/Window: '+scope.sensors[sensor].state.open+'<br>Last Update:  '+scope.sensors[sensor].state.lastupdated+'<br><br>'
                }

                if (--s_iterations <= 0){

                    for (const cam of scope.alarm.alarms[scope.alarm.key].cameras) {

                        scope.alarm.html += "<a href='"+cam.view_url+"'>Click here to view "+cam.name+"</a><br><br>"

                        request({
                            method: 'GET',
                            url: cam.image_url,
                            auth: {
                                user: cam.username,
                                password: cam.password
                            },
                            encoding: null
                        }, (error, response, body) => {

                            if (!error && response.statusCode == 200) {

                                let data = "data:" + response.headers["content-type"] + ";base64," + Buffer.from(body).toString('base64')
                                let base64Data = data.replace(/^data:image\/jpeg;base64,/, "");
                                let imgname = 'images/Cam0-'+new Date().getTime().toString()+'.jpg';
                                let imgurl = "http://3o3mtdevlpmrplgc.myfritz.net:3000/"+imgname

                                fs.writeFile(imgname, base64Data, 'base64', function(err) {
                                    if (err){
                                        console.log(err);
                                    }
                                });

                                scope.alarm.html += '<img src="'+imgurl+'"><br>'

                            } else {

                                console.log(response.statusCode)

                            }

                            if (--iterations <= 0){
                                module.exports.triggerAlarm(scope)
                            }

                        })

                    }

                }
            }



        } else {
            if (alarm === true){
                module.exports.triggerAlarm(scope)
            }
        }


    },

    triggerAlarm(scope){

        if (scope.alarm.key >= 0 && scope.alarm.alarms[scope.alarm.key] && scope.alarm.alarms[scope.alarm.key].email === true){

            let transporter = nodemailer.createTransport({
                host: scope.settings.email.smtp.host,
                port: scope.settings.email.smtp.port,
                secure: scope.settings.email.smtp.secure,
                auth: {
                  user: scope.settings.email.smtp.user,
                  pass: scope.settings.email.smtp.pass
                },
                  tls: {
                      rejectUnauthorized: scope.settings.email.smtp.rejectUnauthorized
                  }
              });

            let mailOptions = {
                from: scope.settings.email.from,
                to: scope.settings.email.recipients,
                subject: scope.alarm.alarms[scope.alarm.key].name+" has been triggered",
                text: scope.alarm.alarms[scope.alarm.key].name+" has been triggered",
                html: scope.alarm.html,
                priority: "high"
            }

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.log(error);
                } else {
                //    console.log('Email sent: ' + info.response);
                }
            });
        }

        scope.alarm.triggered = moment().tz(scope.settings.timezone)
        scope.emit('alarm',scope.alarm)
        hacp.save('alarm',scope)

    },

    put_automations(scope, data, callback){
        scope.automations = {...scope.automations, ...data}
        hacp.save('automations',scope, (data) => {
            if (data == 'ok'){
                callback(200)
            } else {
                callback(500)
            }
        })
    },

    put_devices(scope, data, callback){

        var mac_parse = 'd'+data.mac.toUpperCase().replace(/\:/g,'')
        scope.devices[mac_parse] = {"present":true,"name":data.name,"mac_address":data.mac,"mac_parse":mac_parse}
        hacp.save('devices', scope, (data) => {
            if (data == 'ok'){
                scope.emit('devices',scope.devices[mac_parse],mac_parse)
                var arr = []
                arr.push(scope.devices[mac_parse].mac_address)
                btp.addDevices(arr)
                callback(200)
            } else {
                callback(500)
            }
        })
    },

    put_device_master(scope, data, callback){

        scope.devices[data.mac_parse].is_master = data.is_master
        hacp.save('devices', scope, (data) => {
            if (data == 'ok'){
                scope.emit('devices',scope.devices[data.mac_parse],data.mac_parse)
                callback(200)
            } else {
                callback(500)
            }
        })
    },

    put_alarm(scope, data, callback){

        if (data.key >= 0){
            scope.alarm.alarms[data.key] = data
        } else {
            scope.alarm.alarms.push(data)
        }

        hacp.save('alarm', scope, (data) => {
            if (data == 'ok'){
                scope.emit('alarm',scope.alarm)
                callback(200)
            } else {
                callback(500)
            }
        })

    },

    delete_alarm(scope, key, callback){

        if (key >= 0){
            scope.alarm.alarms.splice(key,1)
        }

        hacp.save('alarm', scope, (data) => {
            if (data == 'ok'){
                scope.emit('alarm',scope.alarm)
                callback(200)
            } else {
                callback(500)
            }
        })

    },

    chDeviceName(scope, id, data, callback){

        scope.devices[id].name = data.name
        hacp.save('devices', scope, (data) => {
            if (data == 'ok'){
                scope.emit('devices',scope.devices[data.mac_parse],data.mac_parse)
                callback(200)
            } else {
                callback(500)
            }
        })

    },

    delete_automations(scope, data, callback){

        if (scope.automations[data.sensor] && scope.automations[data.sensor][data.event] && scope.automations[data.sensor][data.event][data.key]){
            scope.automations[data.sensor][data.event].splice(data.key,1)
            if (scope.automations[data.sensor][data.event].length < 1){
                delete scope.automations[data.sensor][data.event]
            }
        } else if (scope.automations[data.sensor] && scope.automations[data.sensor][data.event]){
            scope.automations[data.sensor].splice(data.event,1)
            if (scope.automations[data.sensor].length < 1){
                delete scope.automations[data.sensor]
            }
        }

        hacp.save('automations',scope, (data2) => {

            if (data2 == 'ok'){

                if (data.sensor.match(/^s|^d/)){ // if sensor automation

                    callback(scope.automations[data.sensor])

                } else { // if scheduled automation

                    if (scope.automations){

                        let schedule = {}
                        async.forEachOf(scope.automations, (item, key, callback2) => {

                            if (key.match(/^[0-9]|^sun/)){
                                schedule[key] = item
                            }
                            callback2()

                        }, (err) => {
                            callback(schedule)
                        })

                    } else {
                        callback()
                    }

                }

            } else {
                callback(500)
            }
        })

    },

    checkAutomation(scope, evnt, val) {

        var automation_data = ''

        if (val && scope.automations && scope.automations[evnt] && scope.automations[evnt][val]){
            automation_data = scope.automations[evnt][val]
        } else if (scope.automations && scope.automations[evnt]){
            automation_data = scope.automations[evnt]
        }

        if (automation_data.length > 0){

            async.eachSeries(automation_data, (item, next) => {

                if (item && typeof item.orig_sensor == 'undefined' && typeof evnt == 'string'){
                    item.orig_sensor = evnt.replace(/^s|v|l|p|d/,'')
                } else if (item && item.orig_sensor){
                    item.orig_sensor = item.orig_sensor.replace(/^s|v|l|p|d/,'')
                } else {
                    item = {}
                    item.orig_sensor = 'unknown'
                }

                if (!item.orig_value && typeof val == 'string'){
                    item.orig_value = val.replace(/^s|v|l|p|d/,'')
                } else if (typeof item.orig_value == 'string') {
                    item.orig_value = item.orig_value.replace(/^s|v|l|p|d/,'')
                }

                if (item.conditions){

                    var test = 'init'

                    async.eachSeries(item.conditions, (cond, cond_next) => {

                        var check_val = ''
                        if (cond.key && cond.child_key && typeof scope[cond.type][cond.id][cond.key][cond.child_key] != 'undefined'){
                            check_val = scope[cond.type][cond.id][cond.key][cond.child_key]
                        } else if (cond.key && typeof scope[cond.type][cond.id][cond.key] != 'undefined'){
                            check_val = scope[cond.type][cond.id][cond.key]
                        } else if (typeof scope[cond.type][cond.id] != 'undefined'){
                            check_val = scope[cond.type][cond.id]
                        }

                        if (test){ // if 1 rule is false, don't check the remaining rules

                            if (cond.op && cond.op == '>' && parseFloat(check_val) > parseFloat(cond.value)){
                            //    console.log('Int gt',parseFloat(check_val), cond.op, parseFloat(cond.value))
                                test = true
                            } else if (cond.op && cond.op == '>=' && parseFloat(check_val) >= parseFloat(cond.value)){
                            //    console.log('Int gt=',parseFloat(check_val), cond.op, parseFloat(cond.value))
                                test = true
                            } else if (cond.op && cond.op == '<' && parseFloat(check_val) < parseFloat(cond.value)){
                            //    console.log('Int lt',parseFloat(check_val), cond.op, parseFloat(cond.value))
                                test = true
                            } else if (cond.op && cond.op == '<=' && parseFloat(check_val) <= parseFloat(cond.value)){
                            //    console.log('Int lt=',parseFloat(check_val), cond.op, parseFloat(cond.value))
                                test = true
                            } else if (cond.op && cond.op == '==' && check_val.toString() == cond.value.toString()){
                            //    console.log('Str ==',check_val.toString(), cond.op, cond.value.toString())
                                test = true
                            } else if (cond.op && cond.op == '==' && check_val === cond.value){
                            //    console.log('Bool ===',check_val, cond.op, cond.value)
                                test = true
                            } else if (check_val.toString() == cond.value.toString()){
                            //    console.log('Str == no op',check_val.toString(), cond.op, cond.value.toString())
                                test = true
                            } else {
                            //    console.log('false',check_val, cond.op, cond.value)
                                test = false
                            }

                        }

                        cond_next()

                    }, (cond_err) => {

                    //    console.log(test)

                        if (item.delete){

                            scope.automations[evnt].splice(scope.automations[evnt].indexOf(item),1) // delete the temp automation object
                            if (scope.automations[evnt].length < 1){ // delete the automation if it's empty
                                delete scope.automations[evnt]
                            }

                            if (scope.sensors[item.orig_sensor] && scope.sensors[item.orig_sensor].state && scope.sensors[item.orig_sensor].state.presence && scope.sensors[item.orig_sensor].state.presence === true){
                                scope.emit('automation_temp_extend',item)
                                module.exports.addTempAutomation(scope, item) // add another temp automation if the trigger is a motion sensor, and it's still detecting presence
                            } else {
                                if (test === true){
                                    scope.emit('automation_temp_run',item)
                                    module.exports.runAutomation(scope, item)
                                }
                            }
                        } else {
                            if (test === true){
                                module.exports.runAutomation(scope, item)
                            }
                        }

                        next()
                    })

                } else {

                    if (item.delete){

                        scope.automations[evnt].splice(scope.automations[evnt].indexOf(item),1) // delete the temp automation object
                        if (scope.automations[evnt].length < 1){ // delete the automation if it's empty
                            delete scope.automations[evnt]
                        }

                        if (scope.sensors[item.orig_sensor] && scope.sensors[item.orig_sensor].state && scope.sensors[item.orig_sensor].state.presence && scope.sensors[item.orig_sensor].state.presence === true){
                            scope.emit('automation_temp_extend',item)
                            module.exports.addTempAutomation(scope, item) // add another temp automation if the trigger is a motion sensor, and it's still detecting presence
                        } else {
                            scope.emit('automation_temp_run',item)
                            module.exports.runAutomation(scope, item)
                        }
                    } else {
                        module.exports.runAutomation(scope, item)
                    }

                    next()

                }

            }, (err) => {
                // done
            })

        }

    },

    runAutomation(scope, data){

        if (typeof data.action == 'undefined'){
            return false
        }

        scope.emit('automation_run',data)

        if (data.transitiontime && parseInt(data.transitiontime)>0){
            data.transitiontime = parseInt(data.transitiontime)
        } else {
            data.transitiontime = 0
        }

        if (data.duration){

            var entity_chk = false // only add the turn off automation if the light/group is currently off

            if (data.action.match(/group/i) && data.entity_id && scope.groups[data.entity_id]){
                entity_chk = scope.groups[data.entity_id].state.any_on
            }

            if (data.action.match(/light/i) && data.entity_id && scope.lights[data.entity_id]){
                entity_chk = scope.lights[data.entity_id].state.on
            }

            if (entity_chk == false){ // only add the auto turn off automation, if the light or group is currently off. If the entity is on, it doesn't need another auto off automation

                module.exports.addTempAutomation(scope, data)

            }

        }

        if (data.action.match(/toggle/)){
            var type = data.action.split('_')
            module.exports.toggle(scope, type[0],data.entity_id, false, data.transitiontime)
        }

        if (data.action.match(/turn\_on/)){
            var type = data.action.split('_')
            module.exports.toggle(scope, type[0],data.entity_id, 'true', data.transitiontime)
        }

        if (data.action.match(/turn\_off/)){
            var type = data.action.split('_')
            module.exports.toggle(scope, type[0],data.entity_id, 'false', data.transitiontime)
        }

        if (data.action.match(/all\_off/)){
            var type = data.action.split('_')
            module.exports.toggle(scope, type[0],scope.all_lights_group_id, 'false', data.transitiontime)
        }

        if (data.action.match(/all\_on/)){
            var type = data.action.split('_')
            module.exports.toggle(scope, type[0],scope.all_lights_group_id, 'true', data.transitiontime)
        }

        if (data.action.match(/colorTemp/) && data.value){
            var type = data.action.split('_')
            module.exports.colorTemp(scope, type[0],data.entity_id,{ct:data.value}, data.transitiontime)
        }

        if (data.action.match(/brightness/) && data.value){
            var type = data.action.split('_')
            module.exports.brightness(scope, type[0],data.entity_id,{bri:data.value}, data.transitiontime)
        }

        if (data.action.match(/play_audio/) && data.value){
            module.exports.play(scope, data.entity_id,data.value,scope.settings)
        }

        if (data.action.match(/activate_scene/) && data.value){
            module.exports.toggle(scope, 'scene',data.entity_id,data.value, data.transitiontime)
        }

    },

    addTempAutomation(scope, data){

        scope.emit('automation_temp_add',data)

        var hrs = moment().tz(scope.settings.timezone).add(parseInt(data.duration),'m').hour()
        var mins = moment().tz(scope.settings.timezone).add(parseInt(data.duration),'m').minute()

        if (mins < 10){
            mins = "0"+mins
        }
        if (hrs < 10){
            hrs = "0"+hrs
        }

        var new_time = hrs+""+mins

        var new_data = JSON.parse(JSON.stringify(data));
//        delete new_data.duration
        delete new_data.conditions

        // if (new_data.action.match(/turn\_off/)){
        //     new_data.action = new_data.action.replace('turn_off','turn_on')
        // } else

        if (new_data.action.match(/turn\_on/)){ // assuming a temp light or group automation will be to turn the entity off
            new_data.action = new_data.action.replace('turn_on','turn_off')
        }

        new_data.delete = true

        if (!scope.automations[new_time]){
            scope.automations[new_time] = []
        }

        scope.automations[new_time].push(new_data)

    },

    cleanAutomations(scope){

        async.forEachOf(scope.automations, (item, key, next) => {

            if (item.length < 1){
                delete scope.automations[key]
            }

            next()
        }, (err) => {
            hacp.save('automations',scope)
        })

    },

    toggle(scope, type, id, data, transitiontime) {

        if (type == 'lights'){
            var url = type+'/'+id+'/state'
            if (!data){
                data = scope.lights[id].state
            }
        } else if (type == 'groups'){
            var url = type+'/'+id+'/action'
            if (!data){
                data = scope.groups[id].action
            }
        } else if (type == 'scene'){
            var url = 'groups/'+id+'/scenes/'+data+'/recall'
        }

        if (type == 'group'){

            if (scope.groups[id].state.any_on === false){
                data.on = true
            } else {
                data.on = false
            }

        } else if (type != 'scene'){

            if (typeof data == 'object'){

                if (data.on === false){
                    data.on = true
                } else if (data.on === true){
                    data.on = false
                }

                var new_data = {
                    on: data.on
                }

            } else if (typeof data == 'string' && data.match(/on|true/i)) {

                var new_data = {
                    on: true
                }

            } else if (typeof data == 'string' && data.match(/off|false/i)) {

                var new_data = {
                    on: false
                }

            }

        } else {
            var new_data = {}
        }

        if (transitiontime){
            new_data.transitiontime = transitiontime
        }

        if (type == 'scene'){ // apply the scene, update the group and emit it to the clients. Deconz doesn't emit a scene update, so this makes up for it

            hacp.apiCall(url, new_data, scope.settings, (res_data) => {
                var group_get_data = {
                    method:'get'
                }
                hacp.apiCall('groups/'+id, group_get_data, scope.settings, (group_data) => {
                //    console.log(group_data)
                    scope.groups[id] = group_data
                    scope.emit('groups',scope.groups[id],id, false, 'init')
                })
            })
        } else {
            hacp.apiCall(url, new_data, scope.settings)
        }
    },

    colorTemp(scope, type, id, data, transitiontime){

        if (type == 'lights'){
            var url = type+'/'+id+'/state'
        } else if (type == 'groups'){
            var url = type+'/'+id+'/action'
        }

        var new_data = {
            ct: parseInt(data.ct)
        }

        if (transitiontime){
            new_data.transitiontime = transitiontime
        }

        hacp.apiCall(url, new_data, scope.settings)

    },

    brightness(scope, type, id, data, transitiontime) {

        if (type == 'lights'){
            var url = type+'/'+id+'/state'
        } else if (type == 'groups'){
            var url = type+'/'+id+'/action'
        }

        var new_data = {
            bri: parseInt(data.bri)
        }

        if (transitiontime){
            new_data.transitiontime = transitiontime
        }

        hacp.apiCall(url, new_data, scope.settings)

    },

    play(scope, type,src){
        hacp.audioCall(type, src, scope.settings)
    },

    hacpPlay(scope, type,src){
        hacp.hacpAudioCall(type, src, scope.settings)
    },

    save(filename, scope, callback){

        if (scope[filename].length > 0 || Object.keys(scope[filename]).length > 0){

            fs.writeFile('./'+filename+'.json', JSON.stringify(scope[filename]), function read(err, data) {
                if (err) {throw err;}
                if (callback){
                    callback('ok')
                }
            });

        }

    }


}
