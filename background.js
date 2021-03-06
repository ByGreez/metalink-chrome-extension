//	Metalink Downloader-Chrome Extension
//	Copyright (C) 2012  
//	Developed by :	Sundaram Ananthanarayanan, Anthony Bryan

//	This program is free software: you can redistribute it and/or modify
//	it under the terms of the GNU General Public License as published by
//	the Free Software Foundation, either version 3 of the License, or
//	(at your option) any later version.

//	This program is distributed in the hope that it will be useful,
//	but WITHOUT ANY WARRANTY; without even the implied warranty of
//	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//	GNU General Public License for more details.

//	You should have received a copy of the GNU General Public License
//	along with this program.  If not, see <http://www.gnu.org/licenses/>

//this is the vector of metalinks to be downloaded.
var objects = [];
var workers = [];
var currentIndex=0;
var currentDownloads=0;
var currentTabURL = "";
var waitingQueue = [];
window.resolveLocalFileSystemURL = window.resolveLocalFileSystemURL || window.webkitResolveLocalFileSystemURL;


const DOWNLOADS_KEY		="PREVIOUS_DOWNLOADS";
const PAUSED_DOWNLOADS_KEY	="PAUSED_DOWNLOADS";
const MBSIZE			=1/(1024*1024);
const AUDIO_FILE_NAME		="done.wav";
const NUMBER_OF_THREADS		="metalinkDownloadsPerServer";
const CHUNK_SIZE		="metalinkChunkSize";
const saveAsOption		="metalinkSaveAsEnabled";


if(localStorage["metalinkConcurrentDownloads"]==undefined)
	localStorage["metalinkConcurrentDownloads"]=1;

if(localStorage[CHUNK_SIZE]==undefined)
	localStorage[CHUNK_SIZE]=256;

const MAX_CONCURRENT_DOWNLOADS=localStorage["metalinkConcurrentDownloads"];

function getBooleanOption(option)
{
	if(localStorage[option]==undefined||localStorage[option]=="false")
		return false;
	return true;
}

//creates context menu for downloading item
function checkIfMetalink(url)
{
	
	return (url.substr(url.length-6)==".meta4")||(url.substr(url.length-9)==".metalink");
}
function clickHandler(e)
{
	startDownload(e.linkUrl);
}
chrome.contextMenus.create({
    "title": "Download this file",
    "contexts": ["link"],
    "onclick" : clickHandler
  });


function initializeObjects()
{
	if(localStorage.getItem(DOWNLOADS_KEY)!=undefined)
		objects=JSON.parse(localStorage.getItem(DOWNLOADS_KEY));
	if(localStorage.getItem(PAUSED_DOWNLOADS_KEY)!=undefined)
	{
		tempObjects=JSON.parse(localStorage.getItem(PAUSED_DOWNLOADS_KEY));
		if(tempObjects)
			for(i=0;i<tempObjects.length;i++)
				if(tempObjects[i]!=undefined)
				{
					tempObjects[i].id=objects.length;
					objects.push(tempObjects[i]);
				}
		localStorage.setItem(PAUSED_DOWNLOADS_KEY,JSON.stringify(tempObjects));
	}
	currentIndex=objects.length;
}
String.prototype.trim = function() {
	return this.replace(/^\s+|\s+$/g,"");
}
function displayParameters(files)
{
	console.log(files.length);
	for(i=0;i<files.length;i++)
	{
		file=files[i];
		console.log(file.size);
		console.log(files[i].fileName);
		for(k=0;k<files[i].urls.length;k++)
			console.log(files[i].urls[k]);
		console.log(file.hash_type);
		console.log(file.hash);
		console.log(file.piece_type);
		console.log(file.piece_length);
		if(file.pieces)
			for(k=0;k<file.pieces.length;k++)
				console.log(files[i].pieces[k]);
	}
}
function extractContents(contents, type)
{
	var files=new Array();
	if(type=="metalink")
	{
		var x = contents.getElementsByTagName("file");
		for(j=0;j<x.length;j++)
		{
			var file=new Object();
			file.fileName=x[j].getAttribute("name");
			var urls=[];
			for(i=0;i<(x[j].childNodes.length-1)/2;i++)
			{
				var v=x[j].childNodes[i*2+1];
				if(v.localName=="size")
					file.size=v.firstChild.nodeValue;
				if(v.localName=="resources")
					for(k=1;k<v.childNodes.length;k+=2)
						if(v.childNodes[k].localName=="url")
							if(v.childNodes[k].getAttribute("type")=="http")
								urls.push(v.childNodes[k].firstChild.nodeValue.trim());

				if(v.localName=="verification")
					for(k=1;k<v.childNodes.length;k+=2)
					{
						if(v.childNodes[k].localName=="hash")
						{
							file.hash_type	=v.childNodes[k].getAttribute("type");
							file.hash	=v.childNodes[k].firstChild.nodeValue;
						}
						if(v.childNodes[k].localName=="pieces")
						{
							file.piece_type		=v.childNodes[k].getAttribute("type");
							file.piece_length	=v.childNodes[k].getAttribute("length");
							pieces=[];
							var hashes=v.childNodes[k];
							for(l=1;l<hashes.childNodes.length;l+=2)
								pieces.push(hashes.childNodes[l].firstChild.nodeValue);
							file.pieces=pieces;
						}
					}
			}
			file.urls=urls;
			files.push(file);
		}
	}
	else
	if(type=="meta4")
	{
		var x = contents.getElementsByTagName("file");
		for(j=0;j<x.length;j++)
		{
			var file=new Object();
			file.fileName=x[j].getAttribute("name");
			var urls=[];
			for(i=0;i<(x[j].childNodes.length-1)/2;i++)
			{
				var v=x[j].childNodes[i*2+1];
				if(v.localName=="size")
					file.size=v.firstChild.nodeValue;
				if(v.localName=="url")
					urls.push(v.firstChild.nodeValue);
				if(v.localName=="hash")
				{
					file.hash_type	=v.getAttribute("type");
					file.hash	=v.firstChild.nodeValue;
				}
				if(v.localName=="pieces")
				{
					file.piece_type		=v.getAttribute("type");
					file.piece_length	=v.getAttribute("length");
					pieces=[];
					var hashes=v;
					for(l=1;l<hashes.childNodes.length;l+=2)
						pieces.push(hashes.childNodes[l].firstChild.nodeValue);
					file.pieces=pieces;
				}
			}
			file.urls=urls;
			files.push(file);
		}
	}
	delete x,file,v,hashes;
	//displayParameters(files);
	return files;
}
function getMetalinkFile(url)
{
	try
	{
		var req = new XMLHttpRequest();
		req.overrideMimeType('text/xml');
		req.open("GET",url,false);
		req.send(null);
		if(url.substr(url.length-6)==".meta4")
			type="meta4";
		else
			type="metalink";
		return extractContents(req.responseXML,type);
	}
	catch(e)
	{
		console.log("XHR Error " + e.toString());
		return -1;
	}
}
function getOrdinaryFile(url)
{
	var client= new XMLHttpRequest();
	client.open("HEAD", url, true);
	/*
	client.onprogress=function()
	{
		console.log(client.status);
		if(client.status==302)
			console.log(client.getAllResponseHeaders());
	}
	*/
	client.onload = 
	function(e)
	{
		if(client.getResponseHeader('Content-Type').indexOf('metalink')!=-1)
		{
			var files=getMetalinkFile(url);
			if(files!=-1)
				downloadFiles(files);
			return;
		}
		var files=new Array();var temp;var file=new Object();
		var MIMEType=client.getResponseHeader('content-type');
		if(MIMEType.indexOf(';')!=-1)
			MIMEType=MIMEType.substring(0,MIMEType.indexOf(';'));
		if(client.getResponseHeader("Content-Disposition")!=null)
			temp=client.getResponseHeader("Content-Disposition")
		if(temp)
			if(temp.indexOf('filename')!=-1)
				file.fileName=temp.substring(temp.indexOf('filename')+('filename').length+2,temp.length-1).trim();
		if(file.fileName==null)
		{
			temp = url.substring(url.lastIndexOf('/')+1);
			if(temp.indexOf('?')!=-1)
				temp=temp.substring(0,temp.indexOf('?'));
			if(!checkIfFilenameHasExtension(temp))
				temp=temp+getExtensionFromMIMEType(MIMEType);
			file.fileName=temp;
		}
		file.size=client.getResponseHeader("Content-Length");
		urls=[];
		urls.push(url);
		file.urls=urls;
		files.push(file);
		downloadFiles(files);
	}
	client.send();
}
function Options(type,title,content,icon)
{
	this.type=type;
	this.title=title;
	this.content=content;
	this.icon=icon;
}
function sendNotification(image, title, message, timeout, showOnFocus)
{
	// Default values for optional params
	timeout = (typeof timeout !== 'undefined') ? timeout : 0;
	showOnFocus = (typeof showOnFocus !== 'undefined') ? showOnFocus : true;

	// Check if the browser window is focused
	var isWindowFocused = document.querySelector(":focus") === null ? false : true;
  
	// Check if we should send the notification based on the showOnFocus parameter
	var shouldNotify = !isWindowFocused || isWindowFocused && showOnFocus;
  
	if (window.webkitNotifications && shouldNotify) 
	{
		// Create the notification object
		var notification = window.webkitNotifications.createNotification(image, title, message);
	    
		// Display the notification
		notification.show();
	    
		if (timeout > 0) {setTimeout(function(){notification.cancel()}, timeout);}
	}
};
function printCurrentDownloads(array)
{
	for(i=0;i<array.length;i++)
		console.log(array[i]);
	return;
}
function savePausedItem(object)
{
	array=JSON.parse(localStorage.getItem(PAUSED_DOWNLOADS_KEY));
	if(array==undefined)
		array=new Array();
	for(i=0;i<array.length;i++)
		if(array[i]==undefined)
		{
			array[i]=object;
			localStorage.setItem(PAUSED_DOWNLOADS_KEY,JSON.stringify(array));
			return;
		}
	array.push(object);
	localStorage.setItem(PAUSED_DOWNLOADS_KEY,JSON.stringify(array));
}
function saveItem(object)
{
	array=JSON.parse(localStorage.getItem(DOWNLOADS_KEY));
	if(array==undefined)
		array=new Array;
	array.push(object);
	localStorage.setItem(DOWNLOADS_KEY,JSON.stringify(array));
}
function deleteItem(id,KEY)
{
	array=JSON.parse(localStorage.getItem(KEY));
	if(array)
	{
		for(i=0;i<array.length;i++)
		{
			if(array[i]!=undefined)
				if(array[i].id==id)
				{
					//console.log('Deleted');
					delete array[i];
				}
		}
		localStorage.setItem(KEY,JSON.stringify(array));
	}
}
function cancelDownload(index)
{
	deleteItem(index,PAUSED_DOWNLOADS_KEY);
	object=objects[index];
	delete object.file.finishedPackets;
	delete object.finishedPackets;
	object.status="Cancelled";
	object.percent=100;
	savePausedItem(object);
}
function getDownloadMessage()
{
	return 'The Metalink is being downloaded by the Extension. Click on the extension icon to track the progress of the download.';
}
function getCodeString(fileName,URL)
{
	return 'try {'+'\n'+
		'var downloadFileHyperLink = document.createElementNS("http://www.w3.org/1999/xhtml", "a");'+'\n'+
	 	'downloadFileHyperLink.href = "'+URL+'";'+'\n'+
		'downloadFileHyperLink.download = "'+fileName+'";'+'\n'+
		'var event = document.createEvent("MouseEvents");'+'\n'+
		'event.initMouseEvent('+'\n'+
				'"click", true, false, self, 0, 0, 0, 0, 0'+'\n'+
				', false, false, false, false, 0, null'+'\n'+
				');'+'\n'+
		'downloadFileHyperLink.dispatchEvent(event);'+'\n'+
        '}'+'\n'+
	'catch (exc) {'+'\n'+
            'alertExceptionDetails(exc);'+'\n'+
        '}'+'\n';
}
function tryDownload(fileName,fileSystemURL)
{
	if(currentTabURL.indexOf('chrome://')!=-1)
	{	
		chrome.tabs.create({url:'http://www.metalinker.org/'},
		function()
			{
				window.resolveLocalFileSystemURL(fileSystemURL, 
				function(fileEntry) 
				{
					fileEntry.file(
						function(f)
						{	
							codeString=getCodeString(fileName,window.webkitURL.createObjectURL(f));
							chrome.tabs.executeScript(null, { code:codeString  });
						}
					);
				});
			}
		);
		return;
	}
	else
	{
		window.resolveLocalFileSystemURL(fileSystemURL, 
				function(fileEntry) 
				{
					fileEntry.file(
						function(f)
						{	
							codeString=getCodeString(fileName,window.webkitURL.createObjectURL(f));
							chrome.tabs.executeScript(null, { code:codeString  });
						}
					);
				});
		//window.webkitURL.revokeObjectURL(url);
	}
}
function pushToWaitingQueue(index)
{
	var object=objects[index];
	//console.log(index);
	object.status="Waiting";
	waitingQueue.push(index);
}
function checkWithinDownloadsLimit(current)
{
	if(current<=MAX_CONCURRENT_DOWNLOADS)
		return true;
	return false;
}
function startNextDownloadFromWaitingQueue()
{
	currentDownloads--;
	if(waitingQueue.length>0)
	{
		index=waitingQueue[0];
		waitingQueue=waitingQueue.slice(1,waitingQueue.length);
		startFileDownload(index);
	}
	return;
}
function startFileDownload(index)
{
	if(!checkWithinDownloadsLimit(currentDownloads+1))
	{
		pushToWaitingQueue(index);
		return;
	}
	currentDownloads++;
	var object=objects[index];
	deleteItem(index,PAUSED_DOWNLOADS_KEY);
	if(object.status=="Cancelled")
	{
		object.percent=0;
		object.downloadedSize=0;
	}


	//this sets the numver of threads that can run in parallel
	if(localStorage[NUMBER_OF_THREADS]!=undefined)
		object.file.count_threads=parseInt(localStorage[NUMBER_OF_THREADS]);
	else
		object.file.count_threads=1;

	if(object.file.chunkSize==undefined)
		object.file.chunkSize=parseInt(localStorage[CHUNK_SIZE]);


	object.status='Downloading';
	var worker = new Worker('downloader.js');
	workers[index]=worker;

	object.file.finishedPackets=object.finishedPackets;

	worker.postMessage({'cmd': 'START', 'url': JSON.stringify(object.file)});
	worker.addEventListener('message',
			function(e)
			{
				data = e.data;
				switch(data.cmd)
				{
					case 'DOWNLOADING':
						object.percent=Math.max(object.percent,(((data.value)/object.size)*100));
						object.downloadedSize=Math.max(object.downloadedSize,(data.value));
						object.speed=data.speed;
						object.status='Downloading';
						break;
					case 'LOG':
						console.log(data.value);break;
					case 'COMPLETE':
						console.log('File Download Completed');
						object.status='Completed';
						object.percent=100;
						delete object.file;
						delete object.finishedPackets;
						saveItem(object);
						play(chrome.extension.getURL(AUDIO_FILE_NAME));
						startNextDownloadFromWaitingQueue();
						break;
					case 'SAVE':
						console.log('save requested from '+data.fileSystemURL);
						tryDownload(object.file.fileName,data.fileSystemURL);
						/*
						if(getBooleanOption(saveAsOption))
							chrome.experimental.downloads.download({filename:object.file.fileName,url: data.value,saveAs:true},function(id) {});
						else
							chrome.experimental.downloads.download({url: data.value},function(id) {});
						*/
						break;
					case 'FAILED':
						object.status='Failed';
						object.percent=100;
						console.log('Download of the file Failed');
						worker.terminate();
						startNextDownloadFromWaitingQueue();
						break;
					case 'VERIFICATION':
						object.status='Verifying';
						object.percent=data.value;
						console.log('Verification Initiated');
						break;
					case 'SIZE':
						object.size=data.value;
						object.file.size=data.value;
						break;
					case 'RESTART':
						object.percent=0;
						object.status="Restarting"
						console.log('Restarting Download');
						break;
					case 'PAUSEDSTATE':
						object.status="Paused";
						object.finishedPackets=JSON.parse(data.value);
						savePausedItem(object);
						startNextDownloadFromWaitingQueue();
						break;
					case 'CANCELLED':
						object.status="Cancelled";
						object.percent=100;
						object.downloadedSize=0;
						delete object.finishedPackets;
						delete object.file.finishedPackets;
						savePausedItem(object);
						startNextDownloadFromWaitingQueue();
						break;
					default:
						console.log(data.cmd);
				};

			}, false);
}
function downloadFiles(files)
{
	sendNotification('http://metalinker.org/images/favicon.ico', 'Download Initiated', getDownloadMessage(), 5000, true);
	for(var i=0;i<files.length;i++)
	{
		var currentFileIndex=currentIndex;
		currentIndex++;
		var object=new Object();
		object.file=files[i];
		object.id=currentFileIndex;
		
		if(files[i].size)
			object.size=files[i].size;
		else
			object.size="Unknown";

		object.clear=false;
		object.percent=0; object.downloadedSize=0; object.status="Waiting"; object.speed=0;
		object.fileName=files[i].fileName;
		objects[currentFileIndex]=object;
		savePausedItem(object);
		startFileDownload(currentFileIndex);
	}
}
function startDownload(url)
{
	if(checkIfMetalink(url))
	{
		var files=getMetalinkFile(url);
		//displayParameters(files);
		if(files!=-1)
			downloadFiles(files);
		return;
	}
	getOrdinaryFile(url);
}
function initializeDownloads()
{
	for(var i=0;i<objects.length;i++)
		if(objects[i].status=="Waiting")
			startFileDownload(i);
}
initializeObjects();
initializeDownloads();
function parseAndStartDownload(link)
{
	endIndex=link.indexOf(';');
	url=link.substring(1,endIndex-1);
	startDownload(url);
}
chrome.webRequest.onBeforeRequest.addListener
(
	function(info)
	{
		fileName=info.url;
		startDownload(fileName);
		return { redirectUrl: "about:blank" }
	},
	{
    		urls: ["http://*/*.metalink","http://*/*.meta4","https://*/*.metalink","https://*/*.meta4"]
	},
  	["blocking"]
);
chrome.tabs.onUpdated.addListener
(
        function(tabId,changeInfo,tab){
                currentTabURL=tab.url;
        }
);
chrome.tabs.onActivated.addListener
(
        function(activeInfo){
                chrome.tabs.get(
                        activeInfo.tabId,
                        function(tab)   {       currentTabURL=tab.url;}
                );
        }
);
/*
chrome.webRequest.onHeadersReceived.addListener
(
	function(info)
	{
		links=info.responseHeaders;
		for(i=0;i<links.length;i++)
			if(links[i].name=="Link")
			{
				link=links[i].value;
				if(link.indexOf(".meta4")!=-1||link.indexOf(".metalink")!=-1)
				{
					parseAndStartDownload(link);
					return { cancel: true };
				}
			}
		return { cancel: false };
	},
	{
    		urls: ["<all_urls>"]
	},
  	["blocking", "responseHeaders"]
);
*/
chrome.extension.onRequest.addListener
(
	function(info, sender, callback) 
	{
		switch(info.cmd)
		{
			case 'DOWNLOAD'	:fileName=info.url;
					startDownload(fileName);
					break;

			case 'PAUSE'	:if(objects[info.data].status=='Downloading')
						workers[info.data].postMessage({'cmd':'PAUSE'});
					break;
			case 'RESUME'	:startFileDownload(info.data);
					break;
			case 'CANCEL'	:if(objects[info.data].status=='Downloading')
						workers[info.data].postMessage({'cmd':'CANCEL'});
					else
						cancelDownload(info.data);
					break;
			case 'RETRY'	:if(objects[info.data].status=="Cancelled")
						startFileDownload(info.data);
					break;
		};
 	}
);
function play(fileName)
{
	var audio = new Audio(fileName);
	audio.play();
	return audio;
}
