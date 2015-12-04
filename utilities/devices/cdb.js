/**
 * Created by djarosz on 11/24/15.
 */
/**
 * The purpose of this file is to allow communication with the component database (CDB) used at the Advance Photon Source (APS).
 *
 * In order to integrate CDB into the traveler module the requirements below must be fullfilled:
 * Service.json file must include:
 *
 * "device_application": "cdb",
 * "cdb" : {
 *  "web_portal_url": "URL to home page of CDB",
 *  "web_service_url": "URL to the CDB web services",
 *  "component_path": "/views/component/view.xhtml?id=REPLACE_ID",
 *  "component_instance_path": "/views/componentInstance/view.xhtml?id=REPLACE_ID",
 *  "design_path": "/views/design/view.xhtml?id=REPLACE_ID",
 *  "design_element_path": "﻿/views/designElement/view?id=REPLACE_ID"
 * }
 *
 */

var config = require('./../../config/config.js');
var request = require('request');

config.load();

var webServiceUrl = config.service.cdb.web_service_url;
var webPortalUrl = config.service.cdb.web_portal_url;
console.log(webServiceUrl);

function getCDBEntityReference(valueOrig, cb){
    value = valueOrig.split(':');
    var id = value[1];
    var entityType = value[0];

    switch(entityType) {
        case 'component':
            getComponentById(id, processComponentResponse);
            break;
        case 'componentInstance':
            getComponentInstanceById(id, processComponentInstanceResponse);
            break;
        case 'design':
            getDesignById(id, processDesignResponse);
            break;
        case 'designElement':
            getDesignElementById(id, processDesignElementResponse);
            break;
        default:
            cb(valueOrig);
    }

    function processComponentResponse(data,error){
        performErrorChecking(data,error).then(function(value) {
            var displayValue = value;
            if (displayValue == undefined) {
                displayValue = "Component: " + data.name;
            }
            constructFinalUrl(config.service.cdb.component_path, displayValue);
        });
    }
    function processComponentInstanceResponse(data,error){
        performErrorChecking(data,error).then(function(value) {
            var displayValue = value;
            if (displayValue == undefined) {
                displayValue = "Component Instance: " + data.component.name;
                if(data.qrId){
                    displayValue += " (QRID: " + data.qrId + ")";
                }
            }
            constructFinalUrl(config.service.cdb.component_instance_path, displayValue);
        });
    }

    function processDesignResponse(data,error){
        performErrorChecking(data,error).then(function(value) {
            var displayValue = value;
            if (displayValue == undefined) {
                displayValue = "Design: " + data.name;
            }
            constructFinalUrl(config.service.cdb.design_path, displayValue);
        });
    }

    function processDesignElementResponse(data,error){
        performErrorChecking(data,error).then(function(value){
            var displayValue = value;
            if(displayValue == undefined){
                displayValue = "Design Element: " + data.name;
            }
            constructFinalUrl(config.service.cdb.design_element_path, displayValue);
        });
    }

    function performErrorChecking(data, error){
        return new Promise(function(resolve){
            var displayValue;
            if(error){
                displayValue = valueOrig;
            }else {
                if (data.errorMessage) {
                    console.error(data.errorMessage);
                    displayValue = "Error: " + data.errorMessage;
                }
            }
            resolve(displayValue)
        });
    }



    function constructFinalUrl(urlPath, displayValue){
        var urlPath = urlPath.replace('REPLACE_ID', id);
        var url = webPortalUrl + urlPath;
        var result = "<a target='_blank' href='" + url + "'>";
        result +=  displayValue;
        result += "</a>"
        cb(result);
    }
}

function getComponentById(id, cb){
    var fullUrl = webServiceUrl+'/componentById/'+id;
    performServiceRequest(fullUrl, cb);
}

function getComponentInstanceById(id, cb){
    var fullUrl = webServiceUrl+'/componentInstanceById/' + id;
    performServiceRequest(fullUrl, cb);
}

function getDesignById(id, cb){
    var fullUrl = webServiceUrl + '/designs/' + id;
    performServiceRequest(fullUrl, cb);
}

function getDesignElementById(id, cb){
    var fullUrl = webServiceUrl + '/designElements/' + id;
    performServiceRequest(fullUrl, cb);
}

function performServiceRequest(fullUrl, cb){
    console.log("Performing API Request: " + fullUrl);
    request({
            strictSSL: false,
            url: fullUrl
        },
        function(error, response){
            if(response != undefined){
                try {
                    response = JSON.parse(response.body);
                } catch (e){
                    error = "Response from server could not be parsed.";
                }
            }
            if (error != undefined){
                console.error(error); 
            }
            cb(response, error);
        });
}

function test(){
    function showResult(data, error){
        console.log('error: ' + JSON.stringify(error));
        console.log('data: ' + data);
    }

    getCDBEntityReference("Component:263", showResult);
    getCDBEntityReference("ComponentInstance:108", showResult);
    getCDBEntityReference("Design:24", showResult);

}

module.exports = {
    getDeviceValue: getCDBEntityReference,
    devicesRemovalAllowed: false
};



