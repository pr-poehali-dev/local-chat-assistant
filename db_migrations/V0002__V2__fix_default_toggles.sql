UPDATE t_p4825665_local_chat_assistant.settings
SET toggles_json = '{"autoExtract":true,"antiDuplicates":true,"topFacts":true}'
WHERE id = 1 AND (toggles_json = '{}' OR toggles_json = '');
