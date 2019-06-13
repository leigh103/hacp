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

    var scope = {
        msg: {},
        groups: [],
        all_lights_group_id: 0,
        daylight_sensor:{
            id: 13,
            state: 'bright',
            lastupdated: new Date(),
            cutoff: {
                dark:20,
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
        timers: {},
        ws:false,
        emit:(obj,data,id,obj_key,evnt) => {

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
                hacp.apiCall('groups', group_get_data, scope.settings, (group_data) => {
                //    console.log(group_data)
                    scope.groups = group_data
                })
            }

            wss.clients.forEach(function each(client) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(data));
                }
            });

            // console.log(JSON.stringify(data))
        }
    }



// include external API functions

    var wss = new WebSocket.Server({ port: 6409 })
    const gateway = require('./partials/gateway.js');
    const hacp = require('./partials/hacp.js');
    const method = require('./partials/methods.js');

// Start Services



    hacp.init(scope, (data) => {

        // start main functions

        gateway.socketConnect(scope)
        hacp.getWeather(scope,method)

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

        wss.on('connection', function connection(ws) {
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

    btp.on('ping-result', (res) => {

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
            method.checkAutomation(scope, mac_parse, 'away')
            method.alarmState(scope, false, 0, true)
            hacp.save('devices', scope)
            scope.emit('devices',scope.devices[mac_parse],mac_parse)

        } else if (res.isPresent == true && scope.devices[mac_parse] && scope.devices[mac_parse].present === false){ // if device goes from away to here

            if (scope.alarm.all_away === true){
                // trigger any device return automation
            }

            // set the event time
            scope.devices[mac_parse].here_at = new Date()
            scope.devices[mac_parse].present = res.isPresent

            // trigger any device home automations and emit the change
            method.checkAutomation(scope, mac_parse, 'here')
            method.alarmState(scope, false, 0, true)
            hacp.save('devices', scope)
            scope.emit('devices',scope.devices[mac_parse],mac_parse)

        }



    })

// web server

    app.get('/', (req, res) => {

        res.send('Hello World')

    })

    app.get('/clean', (req, res) => {

        method.cleanAutomations(scope)
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

        transporter.sendMail(mailOptions, (error, info) => {
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
            scope.emit('groups',scope.groups)
            scope.emit('lights',scope.lights)
            scope.emit('sensors',scope.sensors)
            scope.emit('devices',scope.devices)
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

        hacp.apiCall(req.params.type, get_data, scope.settings, (data) => {
        //    console.log(group_data)
            scope[req.params.type] = data
            scope.emit(req.params.type,scope[req.params.type], false, false, 'init')
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

        hacp.apiCall(req.params.type+'/'+req.params.id, get_data, scope.settings, (data) => {
        //    console.log(group_data)
            scope[req.params.type][req.params.id] = data
            scope.emit(req.params.type,scope[req.params.type][req.params.id],req.params.id, false, 'init')
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
            //    scope.emit('bt_device',{mac:address,name:name},)
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
            async.forEachOf(scope.automations, (item, key, callback) => {

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

        hacp.audioCall(req.params.type,req.params.str, scope)
        res.send('ok')

    });

    app.put('/:entity_type', (req, res) => {

        if (typeof method['put_'+req.params.entity_type] == 'function'){
            method['put_'+req.params.entity_type](scope, req.body, (data) => {
                res.json(data)
            })
        } else {
            res.status(404).send('Not Found')
        }

    });

    app.put('/devices/:id', (req, res) => {

        if (req.body.name){
            method.chDeviceName(scope, req.params.id, req.body, (data) => {
                res.json(data)
            })
        } else {
            res.status(404).send('Not Found')
        }

    });

    app.post('/alarm', (req, res) => {

        if (req.body.type == 'check'){
            if (scope.alarm.alarms[req.body.key] && req.body.code == scope.alarm.alarms[req.body.key].code){
                method.alarmState(scope, true,req.body.key)
                res.sendStatus(200)
            } else {
                res.sendStatus(404)
            }
        }

    })

    app.post('/:entity_type', (req, res) => {

        if (typeof method['delete_'+req.params.entity_type] == 'function'){
            method['delete_'+req.params.entity_type](req.body, (data) => {
                res.json(data)
            })
        } else {
            res.status(404).send('Not Found')
        }

    });

    app.post('/:action/:type/:id', (req, res) => {

        const data = req.body;
        method[req.params.action](req.params.type,req.params.id, data)
        res.send('ok')

    });

    app.listen(3000)

// timer functions

    setInterval(function(){

        scope.time.hours = moment().tz(scope.settings.timezone).hour();
        scope.time.minutes = moment().tz(scope.settings.timezone).minute();
        scope.time.seconds = moment().tz(scope.settings.timezone).second();

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

            method.checkAutomation(scope, scope.time.HHmm)
            scope.emit('schedule',{check:scope.time.HHmm})

        }

        if (scope.time.seconds == 30){ // every minute offset 30s

            method.checkAutomation(scope, ''+parseInt(scope.time.HHmm)-1) // check if any temp automations have been missed
            scope.emit('schedule',{check:scope.time.HHmm})

        }

        if (scope.time.minutes == 0 && scope.time.seconds == 0 || scope.time.minutes == 30 && scope.time.seconds == 0){ // every half hour

            hacp.getWeather(scope,method)

        }

        if (scope.time.minutes == 0 && scope.time.seconds == 0){ // every hour

        }

        if (scope.time.hours == 1 && scope.time.minutes == 0 && scope.time.seconds == 0){ // 1am clean up temp automations

            method.cleanAutomations(scope)

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
            if (scope.ws.readyState != 1){
                console.log('WS down, reconnecting...')
                gateway.socketConnect(scope,method)
            }
        }

    }, 1000);
