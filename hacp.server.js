const btPresence = require('bt-presence').btPresence
const moment = require('moment-timezone')
const async = require('async')
const request = require('request')
const express = require('express')
const bodyParser = require('body-parser')
const cors = require('cors')
const WebSocket = require('ws');
const bluetooth = require('node-bluetooth');
const nodemailer = require('nodemailer');

const app = express();
let btp = new btPresence()
const device = new bluetooth.DeviceINQ();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cors())

// Variables

    var func = {}

    var scope = {
        msg: {},
        groups: [],
        all_lights_group_id: 0,
        daylight_sensor:{
            id: 13,
            state: 'bright',
            cutoff: {
                dim:1700,
                bright:10000
            }
        },
        sensors: [],
        weather: {},
        devices: {
            all_away: true
        },
        time: {
            dawn:false,
            sunrise: false,
            sunset: false,
            dusk: false
        },
        alarm: {},
        timers: {}
    }

    func.wss = new WebSocket.Server({ port: 6409 });

// include external API functions

    var hacp = require('./partials/hacp.js');

// Start Services

    hacp.init(scope, function(data){

        // start main functions

        hacp.socketConnect(scope,func)
        hacp.getWeather(scope,func)

        // start BT presence
        var ii = 0;
        var arr = []
        for (var i in scope.devices){

            if (scope.devices[i].mac_address){
                arr.push(scope.devices[i].mac_address)
            }

            if (ii >= Object.keys(scope.devices).length-1){
                btp.addDevices(arr)
                btp.start(true)
            }
            ii++

        }

        // find all_lights groups id

        for (var i in scope.groups){

            if (scope.groups[i].name.match(/all(\s|_)lights/i)){
                scope.all_lights_group_id = i
                break
            }
        }

        // start webserver for control panel clients

        func.wss.on('connection', function connection(ws) {
            ws.send('connected');
        });

        if(scope.sensors[1] && scope.sensors[1].state && scope.sensors[1].state.status){ // init the sun position values

            if (parseInt(scope.sensors[1].state.status) >= 130 && parseInt(scope.sensors[1].state.status) < 140){ // dawn
                scope.time.dawn = true
                scope.time.sunrise = false
                scope.time.sunset = true
                scope.time.dusk = false
            }

            if (parseInt(scope.sensors[1].state.status) >= 140 && parseInt(scope.sensors[1].state.status) < 180){ // sunrise
                scope.time.dawn = true
                scope.time.sunrise = true
                scope.time.sunset = false
                scope.time.dusk = false
            }

            if (parseInt(scope.sensors[1].state.status) >= 180 && parseInt(scope.sensors[1].state.status) < 200){ // sunset
                scope.time.dawn = true
                scope.time.sunrise = false
                scope.time.sunset = true
                scope.time.dusk = false
            }

            if (parseInt(scope.sensors[1].state.status) >= 200 && parseInt(scope.sensors[1].state.status) < 230){ // dusk
                scope.time.dawn = false
                scope.time.sunrise = false
                scope.time.sunset = true
                scope.time.dusk = true
            }

        }

    })

// BT Presence functions

    btp.on('ping-result', function(res){

//        console.log(res)

        var mac_parse = 'd'+res.address.toUpperCase().replace(/\:/g,'')

        if (scope.devices[mac_parse] && !scope.devices[mac_parse].mac_parse){
            scope.devices[mac_parse].mac_parse = mac_parse
        }

        if (res.isPresent == false && scope.devices[mac_parse] && scope.devices[mac_parse].present === true){ // if device goes from here to away

            // set the event time
            scope.devices[mac_parse].left_at = new Date()
            scope.devices[mac_parse].present = res.isPresent

            // trigger any device home automations and emit the change
            func.checkAutomation(mac_parse, 'away')
            func.alarmState(false, 0, true)
            hacp.save('devices', scope)
            func.emit('devices',scope.devices[mac_parse],mac_parse)

        } else if (res.isPresent == true && scope.devices[mac_parse] && scope.devices[mac_parse].present === false){ // if device goes from away to here

            if (scope.alarm.all_away === true){
                // trigger any device return automation
            }

            // set the event time
            scope.devices[mac_parse].here_at = new Date()
            scope.devices[mac_parse].present = res.isPresent

            // trigger any device home automations and emit the change
            func.checkAutomation(mac_parse, 'here')
            func.alarmState(false, 0, true)
            hacp.save('devices', scope)
            func.emit('devices',scope.devices[mac_parse],mac_parse)

        }



    })

// web server

    app.get('/', function (req, res) {

        res.send('Hello World')

    })

    app.get('/clean', function (req, res) {

        func.cleanAutomations()
        res.send('Done')

    })

    app.get('/all', (req, res) => {

        var data = {
            devices: scope.devices,
            groups: scope.groups,
            lights: scope.lights,
            sensors: scope.sensors,
            alarm: scope.alarm,
            time: scope.time,
            weather: scope.weather
        }

        res.json(data)

    })

    app.get('/test-email', (req, res) => {
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
            from: "HACP",
            to: scope.settings.email.recipients,
            subject: "This is a test email",
            text: "Your HACP email settings have been validated, nice work!",
            html: "<b>Your HACP email settings have been validated, nice work!</b>"
        }

        transporter.sendMail(mailOptions, function(error, info){
            if (error) {
            //    console.log(error)
                res.send(error);
            } else {
            //    console.log('Email sent: ' + info.response)
                res.send('Email sent: ' + info.response);
            }
        });
    })

    app.get('/init', (req, res) => {

        hacp.init(scope, function(data){
            func.emit('groups',scope.groups)
            func.emit('lights',scope.lights)
            func.emit('sensors',scope.sensors)
            func.emit('devices',scope.devices)
            res.sendStatus(200)
        })

    })

    app.get('/init/:type', (req, res) => {

        if (!req.params.type.match(/groups|lights|sensors/)){
            res.sendStatus(404)
            return false
        }

        var get_data = {
            method:'get'
        }

        hacp.apiCall(req.params.type, get_data, scope.settings, function(data){
        //    console.log(group_data)
            scope[req.params.type] = data
            func.emit(req.params.type,scope[req.params.type], false, false, 'init')
            res.sendStatus(200)
        })

    })

    app.get('/init/:type/:id', (req, res) => {

        if (!req.params.type.match(/groups|lights|sensors/)){
            res.sendStatus(404)
            return false
        }

        var get_data = {
            method:'get'
        }

        hacp.apiCall(req.params.type+'/'+req.params.id, get_data, scope.settings, function(data){
        //    console.log(group_data)
            scope[req.params.type][req.params.id] = data
            func.emit(req.params.type,scope[req.params.type][req.params.id],req.params.id, false, 'init')
            res.sendStatus(200)
        })

    })

    app.get('/btp', (req,res) => {
        res.json(btp.getDevices())
    })

    app.get('/bluetooth', (req,res) => {
        var devices = []
        device
            .on('finished',  () => {
                //console.log(devices);
                if (!res.headersSent){
                    res.json(devices)
                }
            })
            .on('found', function found(address, name){
                var mac_parse = 'd'+address.toUpperCase().replace(/\:/g,'')
                devices.push({mac:address,name:name,mac_parse:mac_parse});
            //    func.emit('bt_device',{mac:address,name:name},)
            }).scan()
    })

    app.get('/:entity_type/:id', (req, res) => {

        if (scope[req.params.entity_type] && scope[req.params.entity_type][req.params.id]){
            res.json(scope[req.params.entity_type][req.params.id])
        } else {
            res.status(404).send('Not Found')
        }

    })

    app.get('/scheduled-automations', (req, res) => {

        if (scope.automations){

            let schedule = {}
            async.forEachOf(scope.automations, function(item, key, callback){

                if (key.match(/^[0-9]{4}|sunset|sunrise|dusk|dawn|daylight/)){
                    schedule[key] = item
                }
                callback()

            }, function(err){
                res.json(schedule)
            })

        } else {
            res.status(404).send('Not Found')
        }

    })

    app.get('/:entity_type', (req, res) => {

        if (scope[req.params.entity_type]){
            res.json(scope[req.params.entity_type])
        } else {
            res.status(404).send('Not Found')
        }

    })

    app.get('/play/:type/:str', (req, res) => {

        func.play(req.params.type,req.params.str)
        res.send('ok')

    });

    app.put('/:entity_type', (req, res) => {

        if (typeof func['put_'+req.params.entity_type] == 'function'){
            func['put_'+req.params.entity_type](req.body, function(data){
                res.json(data)
            })
        } else {
            res.status(404).send('Not Found')
        }

    });

    app.put('/devices/:id', (req, res) => {

        if (req.body.name){
            func.chDeviceName(req.params.id, req.body, function(data){
                res.json(data)
            })
        } else {
            res.status(404).send('Not Found')
        }

    });

    app.post('/alarm', (req, res) => {

        if (req.body.type == 'check'){
            if (scope.alarm.alarms[req.body.key] && req.body.code == scope.alarm.alarms[req.body.key].code){
                func.alarmState(true,req.body.key)
                res.sendStatus(200)
            } else {
                res.sendStatus(404)
            }
        }

    })

    app.post('/:entity_type', (req, res) => {

        if (typeof func['delete_'+req.params.entity_type] == 'function'){
            func['delete_'+req.params.entity_type](req.body, function(data){
                res.json(data)
            })
        } else {
            res.status(404).send('Not Found')
        }

    });

    app.post('/:action/:type/:id', (req, res) => {

        const data = req.body;
        func[req.params.action](req.params.type,req.params.id, data)
        res.send('ok')

    });

    app.listen(3000)

// timer functions

    setInterval(function(){

        scope.time.hours = moment().tz('Europe/London').hour();
        scope.time.minutes = moment().tz('Europe/London').minute();
        scope.time.seconds = moment().tz('Europe/London').second();

        if (scope.time.minutes < 10){
            scope.time.minutes = "0"+scope.time.minutes
        }
        if (scope.time.hours < 10){
            scope.time.hours = "0"+scope.time.hours
        }
        if (scope.time.seconds < 10){
            scope.time.seconds = "0"+scope.time.seconds
        }

        scope.time.HHmm = scope.time.hours+''+scope.time.minutes
        scope.time.HHmmss = scope.time.hours+''+scope.time.minutes+''+scope.time.seconds
        scope.time.day_num = moment().weekday();

        if (scope.time.day_num == 0 || scope.time.day_num == 6){
            scope.time.weekend = true
            scope.time.weekday = false
        } else {
            scope.time.weekend = false
            scope.time.weekday = true
        }

        var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
        scope.time.day = days[scope.time.day_num]

        if (scope.time.seconds == 0){ // every minute

            func.checkAutomation(scope.time.HHmm)
            func.emit('schedule',{check:scope.time.HHmm})

        }

        if (scope.time.seconds == 30){ // every minute offset 30s

            func.checkAutomation(''+parseInt(scope.time.HHmm)-1) // check if any temp automations have been missed
            func.emit('schedule',{check:scope.time.HHmm})

        }

        if (scope.time.minutes == 0 && scope.time.seconds == 0 || scope.time.minutes == 30 && scope.time.seconds == 0){ // every half hour

            hacp.getWeather(scope,func)

        }

        if (scope.time.minutes == 0 && scope.time.seconds == 0){ // every hour

        }

        if (scope.time.hours == 1 && scope.time.minutes == 0 && scope.time.seconds == 0){ // 1am clean up temp automations

            func.cleanAutomations()

        }

        if (scope.time.hours >= 0 && scope.time.hours < 7) { // night time
            scope.time.time_of_day = "Night Time"
        } else if (scope.time.hours >= 7 && scope.time.hours < 12) { // morning
            scope.time.time_of_day = "Morning"
        } else if (scope.time.hours >= 12 && scope.time.hours < 17) { // afternoon
            scope.time.time_of_day = "Afternoon"
        } else if (scope.time.hours >= 17 && scope.time.hours < 24) { // evening
            scope.time.time_of_day = "Evening"
        }

        if (scope.time.seconds % 10 === 0){
            if (func.ws.readyState != 1){
                console.log('WS down, reconnecting...')
                hacp.socketConnect(scope,func)
            }
        }

    }, 1000);

// functions

    func.alarmState = function(set, key, chk_devices){

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
                            func.setAlarm(key)
                            func.checkAutomation('all_devices', 'away')
                            func.emit('alarm',scope.alarm)

                        } else {

                            scope.alarm.setting = moment().tz('Europe/London').add(5,'m')

                            if (!scope.timers.devices){
                                scope.timers.devices = setTimeout(function(){ // wait 5 mins before setting the alarm
                                    func.alarmState(true, key, true)
                                },300000)
                            }
                            func.emit('alarm',scope.alarm)
                            hacp.save('alarm',scope)

                        }

                    } else {

                        if (scope.timers.devices){
                            clearTimeout(scope.timers.devices)
                        }
                        func.setAlarm(false)
                        func.emit('devices','false','all_away')
                    }

                } else {

                    cnt++

                }

            }

        } else if (set === true && !chk_devices) { // force set/unset the alarm

            func.setAlarm(key)

        }
    }

    func.setAlarm = function(key){

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

        func.emit('alarm',scope.alarm)
        hacp.save('alarm',scope)

    }

    func.triggerAlarm = function(){

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
                from: "HACP",
                to: scope.settings.email.recipients,
                subject: scope.alarm.alarms[scope.alarm.key].name+" has been triggered",
                text: "Node.js New world for me",
                html: "<b>Node.js New world for me</b>",
                priority: "high"
            }

            transporter.sendMail(mailOptions, function(error, info){
                if (error) {
                    console.log(error);
                } else {
                //    console.log('Email sent: ' + info.response);
                }
            });
        }

        scope.alarm.triggered = moment().tz('Europe/London')
        func.emit('alarm',scope.alarm)
        hacp.save('alarm',scope)

    }

    func.put_automations = function(data, callback){
        scope.automations = {...scope.automations, ...data}
        hacp.save('automations',scope, function(data){
            if (data == 'ok'){
                callback(200)
            } else {
                callback(500)
            }
        })
    }

    func.put_devices = function(data, callback){

        var mac_parse = 'd'+data.mac.toUpperCase().replace(/\:/g,'')
        scope.devices[mac_parse] = {"present":true,"name":data.name,"mac_address":data.mac,"mac_parse":mac_parse}
        hacp.save('devices', scope, function(data){
            if (data == 'ok'){
                func.emit('devices',scope.devices[mac_parse],mac_parse)
                var arr = []
                arr.push(scope.devices[mac_parse].mac_address)
                btp.addDevices(arr)
                callback(200)
            } else {
                callback(500)
            }
        })
    }

    func.put_device_master = function(data, callback){

        scope.devices[data.mac_parse].is_master = data.is_master
        hacp.save('devices', scope, function(data){
            if (data == 'ok'){
                func.emit('devices',scope.devices[data.mac_parse],data.mac_parse)
                callback(200)
            } else {
                callback(500)
            }
        })
    }

    func.chDeviceName = function(id, data, callback){

        scope.devices[id].name = data.name
        hacp.save('devices', scope, function(data){
            if (data == 'ok'){
                func.emit('devices',scope.devices[data.mac_parse],data.mac_parse)
                callback(200)
            } else {
                callback(500)
            }
        })

    }

    func.delete_automations = function(data, callback){

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

        hacp.save('automations',scope, function(data2){

            if (data2 == 'ok'){

                if (data.sensor.match(/^s|^d/)){ // if sensor automation

                    callback(scope.automations[data.sensor])

                } else { // if scheduled automation

                    if (scope.automations){

                        let schedule = {}
                        async.forEachOf(scope.automations, function(item, key, callback2){

                            if (key.match(/^[0-9]|^sun/)){
                                schedule[key] = item
                            }
                            callback2()

                        }, function(err){
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

    }

    func.checkAutomation = function(evnt, val){

        var automation_data = ''

        if (val && scope.automations && scope.automations[evnt] && scope.automations[evnt][val]){
            automation_data = scope.automations[evnt][val]
        } else if (scope.automations && scope.automations[evnt]){
            automation_data = scope.automations[evnt]
        }

        if (automation_data.length > 0){

            async.eachSeries(automation_data, function (item, next){

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

                    async.eachSeries(item.conditions, function (cond, cond_next){

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

                    }, function(cond_err){

                    //    console.log(test)

                        if (item.delete){

                            scope.automations[evnt].splice(scope.automations[evnt].indexOf(item),1) // delete the temp automation object
                            if (scope.automations[evnt].length < 1){ // delete the automation if it's empty
                                delete scope.automations[evnt]
                            }

                            if (scope.sensors[item.orig_sensor] && scope.sensors[item.orig_sensor].state && scope.sensors[item.orig_sensor].state.presence && scope.sensors[item.orig_sensor].state.presence === true){
                                func.emit('automation_temp_extend',item)
                                func.addTempAutomation(item) // add another temp automation if the trigger is a motion sensor, and it's still detecting presence
                            } else {
                                if (test === true){
                                    func.emit('automation_temp_run',item)
                                    func.runAutomation(item)
                                }
                            }
                        } else {
                            if (test === true){
                                func.runAutomation(item)
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
                            func.emit('automation_temp_extend',item)
                            func.addTempAutomation(item) // add another temp automation if the trigger is a motion sensor, and it's still detecting presence
                        } else {
                            func.emit('automation_temp_run',item)
                            func.runAutomation(item)
                        }
                    } else {
                        func.runAutomation(item)
                    }

                    next()

                }

            }, function(err){
                // done
            })

        }

    }

    func.runAutomation = function(data){

        if (typeof data.action == 'undefined'){
            return false
        }

        func.emit('automation_run',data)

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

                func.addTempAutomation(data)

            }

        }

        if (data.action.match(/toggle/)){
            var type = data.action.split('_')
            func.toggle(type[0],data.entity_id, false, data.transitiontime)
        }

        if (data.action.match(/turn\_on/)){
            var type = data.action.split('_')
            func.toggle(type[0],data.entity_id, 'true', data.transitiontime)
        }

        if (data.action.match(/turn\_off/)){
            var type = data.action.split('_')
            func.toggle(type[0],data.entity_id, 'false', data.transitiontime)
        }

        if (data.action.match(/all\_off/)){
            var type = data.action.split('_')
            func.toggle(type[0],scope.all_lights_group_id, 'false', data.transitiontime)
        }

        if (data.action.match(/all\_on/)){
            var type = data.action.split('_')
            func.toggle(type[0],scope.all_lights_group_id, 'true', data.transitiontime)
        }

        if (data.action.match(/colorTemp/) && data.value){
            var type = data.action.split('_')
            func.colorTemp(type[0],data.entity_id,{ct:data.value}, data.transitiontime)
        }

        if (data.action.match(/brightness/) && data.value){
            var type = data.action.split('_')
            func.brightness(type[0],data.entity_id,{bri:data.value}, data.transitiontime)
        }

        if (data.action.match(/play_audio/) && data.value){
            func.play(data.entity_id,data.value,scope.settings)
        }

        if (data.action.match(/activate_scene/) && data.value){
            func.toggle('scene',data.entity_id,data.value, data.transitiontime)
        }

    }

    func.addTempAutomation = function(data){

        func.emit('automation_temp_add',data)

        var hrs = moment().tz('Europe/London').add(parseInt(data.duration),'m').hour()
        var mins = moment().tz('Europe/London').add(parseInt(data.duration),'m').minute()

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

    }

    func.cleanAutomations = function(){

        async.forEachOf(scope.automations, function (item, key, next){

            if (item.length < 1){
                delete scope.automations[key]
            }

            next()
        }, function(err){
            hacp.save('automations',scope)
        })

    }

    func.toggle = function(type, id, data, transitiontime){

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

            hacp.apiCall(url, new_data, scope.settings, function(res_data){
                var group_get_data = {
                    method:'get'
                }
                hacp.apiCall('groups/'+id, group_get_data, scope.settings, function(group_data){
                //    console.log(group_data)
                    scope.groups[id] = group_data
                    func.emit('groups',scope.groups[id],id, false, 'init')
                })
            })
        } else {
            hacp.apiCall(url, new_data, scope.settings)
        }
    }

    func.colorTemp = function(type, id, data, transitiontime){

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

    }

    func.brightness = function(type, id, data, transitiontime){

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

    }

    func.play = function(type,src){
        hacp.audioCall(type, src, scope.settings)
    }

// events

    func.emit = function(obj,data,id,obj_key,evnt){

        var data = {
            e: 'changed',
            r: obj,
            state: data,
            t: 'event'
        }

        if (id){
            data.id = id
        }

        if (evnt){
            data.e = evnt
        }

        if (obj_key){
            data[obj_key] = data.state
            delete data.state
        }

        if (obj == 'scenes'){
            var group_get_data = {
                method:'get'
            }
            hacp.apiCall('groups', group_get_data, scope.settings, function(group_data){
            //    console.log(group_data)
                scope.groups = group_data
            })
        }

        func.wss.clients.forEach(function each(client) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
            }
        });

        // console.log(JSON.stringify(data))
    }
