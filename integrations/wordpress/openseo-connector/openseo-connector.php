<?php
/**
 * Plugin Name:       OpenSEO Connector
 * Description:       Lets OpenSEO read and update SEO titles and meta descriptions (Yoast SEO or Rank Math) and find pages and images by URL. Access is granted per user through Application Passwords.
 * Version:           1.0.0
 * Requires at least: 5.6
 * Requires PHP:      7.4
 * Author:            OpenSEO
 * License:           AGPL-3.0-or-later
 */

if (!defined('ABSPATH')) {
	exit;
}

define('OPENSEO_CONNECTOR_VERSION', '1.0.0');

/**
 * The SEO plugin whose fields OpenSEO edits, or null when neither is active.
 */
function openseo_connector_seo_plugin() {
	if (defined('WPSEO_VERSION')) {
		return 'yoast';
	}
	if (class_exists('RankMath')) {
		return 'rank-math';
	}
	return null;
}

function openseo_connector_meta_keys($plugin) {
	if ($plugin === 'yoast') {
		return array('title' => '_yoast_wpseo_title', 'description' => '_yoast_wpseo_metadesc');
	}
	if ($plugin === 'rank-math') {
		return array('title' => 'rank_math_title', 'description' => 'rank_math_description');
	}
	return null;
}

function openseo_connector_seo_values($post_id, $plugin) {
	$keys = openseo_connector_meta_keys($plugin);
	if (!$keys) {
		return null;
	}
	return array(
		'title'       => (string) get_post_meta($post_id, $keys['title'], true),
		'description' => (string) get_post_meta($post_id, $keys['description'], true),
	);
}

/**
 * Resolve a public URL on this site to a post ID, including the static front page.
 */
function openseo_connector_url_to_post_id($url) {
	$post_id = url_to_postid($url);
	if ($post_id) {
		return $post_id;
	}
	$path = trailingslashit((string) wp_parse_url($url, PHP_URL_PATH));
	$home = trailingslashit((string) wp_parse_url(home_url('/'), PHP_URL_PATH));
	if ($path === $home && get_option('show_on_front') === 'page') {
		return (int) get_option('page_on_front');
	}
	return 0;
}

/**
 * Resolve an image URL (full size or a resized copy) to its Media Library ID.
 */
function openseo_connector_image_url_to_id($url) {
	$url = strtok($url, '?#');
	$id  = attachment_url_to_postid($url);
	if (!$id) {
		// Resized copies (photo-300x200.jpg) and big-image copies (photo-scaled.jpg).
		$original = preg_replace('/-(\d+x\d+|scaled)(\.[a-z0-9]+)$/i', '$2', $url);
		if ($original !== $url) {
			$id = attachment_url_to_postid($original);
		}
	}
	return $id && get_post_type($id) === 'attachment' ? (int) $id : 0;
}

function openseo_connector_post_summary($post) {
	$type = get_post_type_object($post->post_type);
	return array(
		'id'        => $post->ID,
		'type'      => $post->post_type,
		'rest_base' => $type && $type->show_in_rest ? ($type->rest_base ? $type->rest_base : $post->post_type) : null,
		'status'    => $post->post_status,
		'title'     => get_the_title($post),
		'link'      => get_permalink($post),
	);
}

/**
 * A post's summary and SEO fields, or a 404 when the user can't edit it.
 */
function openseo_connector_post_response($post_id) {
	$post = $post_id ? get_post($post_id) : null;
	if (!$post || !current_user_can('edit_post', $post->ID)) {
		return new WP_Error('openseo_not_found', 'No page or post you can edit has this URL.', array('status' => 404));
	}
	$plugin = openseo_connector_seo_plugin();
	return array_merge(openseo_connector_post_summary($post), array(
		'seo_plugin' => $plugin,
		'seo'        => openseo_connector_seo_values($post->ID, $plugin),
	));
}

add_action('rest_api_init', function () {
	$can_edit = function () {
		return current_user_can('edit_posts');
	};

	register_rest_route('openseo/v1', '/status', array(
		'methods'             => 'GET',
		'permission_callback' => $can_edit,
		'callback'            => function () {
			return array(
				'version'    => OPENSEO_CONNECTOR_VERSION,
				'seo_plugin' => openseo_connector_seo_plugin(),
			);
		},
	));

	register_rest_route('openseo/v1', '/lookup', array(
		'methods'             => 'GET',
		'permission_callback' => $can_edit,
		'args'                => array(
			'url' => array('type' => 'string', 'required' => true, 'format' => 'uri'),
		),
		'callback'            => function (WP_REST_Request $request) {
			return openseo_connector_post_response(openseo_connector_url_to_post_id($request['url']));
		},
	));

	register_rest_route('openseo/v1', '/post/(?P<id>\\d+)', array(
		'methods'             => 'GET',
		'permission_callback' => $can_edit,
		'callback'            => function (WP_REST_Request $request) {
			return openseo_connector_post_response((int) $request['id']);
		},
	));

	register_rest_route('openseo/v1', '/media-lookup', array(
		'methods'             => 'POST',
		'permission_callback' => function () {
			return current_user_can('upload_files');
		},
		'args'                => array(
			'urls' => array(
				'type'     => 'array',
				'required' => true,
				'maxItems' => 100,
				'items'    => array('type' => 'string'),
			),
		),
		'callback'            => function (WP_REST_Request $request) {
			$results = array();
			foreach ($request['urls'] as $url) {
				$id        = openseo_connector_image_url_to_id((string) $url);
				$editable  = $id && current_user_can('edit_post', $id);
				$results[] = array(
					'url' => $url,
					'id'  => $editable ? $id : null,
					'alt' => $editable ? (string) get_post_meta($id, '_wp_attachment_image_alt', true) : null,
				);
			}
			return $results;
		},
	));

	register_rest_route('openseo/v1', '/seo/(?P<id>\d+)', array(
		'methods'             => 'POST',
		'permission_callback' => function (WP_REST_Request $request) {
			return current_user_can('edit_post', (int) $request['id']);
		},
		'args'                => array(
			'title'       => array('type' => 'string'),
			'description' => array('type' => 'string'),
		),
		'callback'            => function (WP_REST_Request $request) {
			$post_id = (int) $request['id'];
			if (!get_post($post_id)) {
				return new WP_Error('openseo_not_found', 'This page no longer exists.', array('status' => 404));
			}
			$plugin = openseo_connector_seo_plugin();
			$keys   = openseo_connector_meta_keys($plugin);
			if (!$keys) {
				return new WP_Error('openseo_no_seo_plugin', 'Yoast SEO or Rank Math must be active to change SEO titles and descriptions.', array('status' => 409));
			}
			$before = openseo_connector_seo_values($post_id, $plugin);
			foreach (array('title', 'description') as $field) {
				if (!$request->has_param($field)) {
					continue;
				}
				$value = sanitize_text_field($request[$field]);
				if ($value === '') {
					// Empty means "use the SEO plugin's default template".
					delete_post_meta($post_id, $keys[$field]);
				} else {
					update_post_meta($post_id, $keys[$field], wp_slash($value));
				}
			}
			clean_post_cache($post_id);
			return array(
				'seo_plugin' => $plugin,
				'before'     => $before,
				'after'      => openseo_connector_seo_values($post_id, $plugin),
			);
		},
	));
});
