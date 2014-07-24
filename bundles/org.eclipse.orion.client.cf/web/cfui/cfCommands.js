/*******************************************************************************
 * @license
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2014. All Rights Reserved. 
 * 
 * Note to U.S. Government Users Restricted Rights:  Use, 
 * duplication or disclosure restricted by GSA ADP Schedule 
 * Contract with IBM Corp.
 *******************************************************************************/
 /*global define*/
define(['orion/Deferred', 'orion/commands', 'orion/commandRegistry'], function(Deferred, mCommands, mCommandRegistry){
	return {
		createCfCommands: function(serviceRegistry, commandService, explorer){
			
			var progressService = serviceRegistry.getService("orion.page.progress");
			var cfClient = serviceRegistry.getService("orion.cf.service");
			
			var createRouteParameters = new mCommandRegistry.ParametersDescription(
					[new mCommandRegistry.CommandParameter("domain", "text", 'Domain:'),
					 new mCommandRegistry.CommandParameter("host", "text", 'Host:')]);
			
			var createRouteCommand = new mCommands.Command({
				name : "Create",
				tooltip: "Create route",
				id : "orion.cf.CreateRoute",
				parameters: createRouteParameters,
				
				callback : function(data) {
					var target = data.items;
					
					var domain = data.parameters.valueFor("domain");
					var host = data.parameters.valueFor("host");
					
					progressService.showWhile(cfClient.createRoute(target, 
							domain, host), "Creating route...").then(
						function(jazzResp) {
							explorer.changedItem();
						}, function (error) {
							exports.handleError(error, progressService);
						}
					);
				},
				visibleWhen : function(item) {
					return true;
				}
			});
			
			commandService.addCommand(createRouteCommand);
			
			var deleteOrphanedRoutesCommand = new mCommands.Command({
				name : "Delete All Unmapped",
				tooltip: "Delete all unmapped routes",
				id : "orion.cf.DeleteOrphanedRoutes",
				
				callback : function(data) {
					var target = data.items;
					
					progressService.showWhile(cfClient.deleteOrphanedRoutes(target), 
						"Deleteing all unmapped routes...").then(
						function(jazzResp) {
							explorer.changedItem();
						}, function (error) {
							exports.handleError(error, progressService);
						}
					);
				},
				visibleWhen : function(item) {
					return true;
				}
			});
			
			commandService.addCommand(deleteOrphanedRoutesCommand);
			
			var deleteRouteCommand = new mCommands.Command({
				name : "Delete",
				tooltip: "Delete route",
				id : "orion.cf.DeleteRoute",
				
				callback : function(data) {
					var route = data.items;
					
					progressService.showWhile(cfClient.deleteRouteById(target, 
						route.Guid), "Deleting route...").then(
						function(jazzResp) {
							explorer.changedItem();
						}, function (error) {
							exports.handleError(error, progressService);
						}
					);
				},
				visibleWhen : function(item) {
					if(!Array.isArray(item)){
						item = [item];
					}
					
					for (var i = 0; i < item.length; i++) {
					    if (!item[i].Type || item[i].Type !== "Route")
					    	return false;
					}
					
					return true;
				}
			});
			
			commandService.addCommand(deleteRouteCommand);
			
			var mapRouteCommand = new mCommands.Command({
				name : "Map to app",
				tooltip: "Add the route to an app",
				id : "orion.cf.MapRoute",
				
				callback : function(data) {
					var route = data.items;
				},
				visibleWhen : function(item) {
					if(!Array.isArray(item)){
						item = [item];
					}
					
					return item.length === 1 && item[0].Type === "Route";
				}
			});
			
			commandService.addCommand(mapRouteCommand);
			
			var unmapRouteCommand = new mCommands.Command({
				name : "Unmap from app",
				tooltip: "Add the route from an app",
				id : "orion.cf.UnmapRoute",
				
				callback : function(data) {
					var route = data.items;
				},
				visibleWhen : function(item) {
					if(!Array.isArray(item)){
						item = [item];
					}
					
					return item.length === 1 && item[0].Type === "Route";
				}
			});
			
			commandService.addCommand(unmapRouteCommand);
		},
		createRoutesCommands: function(serviceRegistry, commandService, explorer){
			
		}
	};
});