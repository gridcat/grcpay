function check_status(ajax_url) {
    let is_paid = false;

    function status_loop() {
        if (is_paid) return;

        jQuery.getJSON(ajax_url, function (data) {
            let waiting_payment = jQuery('.waiting_payment');
            let waiting_network = jQuery('.waiting_network');
            let payment_done = jQuery('.payment_done');

            // All payload fields are injected as text — never as HTML —
            // because some of them (refund_tx, qr_code_value, history
            // entries) ultimately come from the grcpay JSON API. A
            // compromised or impersonated grcpay must not be able to land
            // an HTML/JS payload in the customer's checkout page.
            jQuery('.grcpay_value').text(data.remaining);
            jQuery('.grcpay_fiat_total').text(data.fiat_remaining);
            jQuery('.grcpay_copy.grcpay_details_copy').attr('data-tocopy', data.remaining);

            if (data.cancelled === 1) {
                jQuery('.grcpay_loader').remove();
                jQuery('.grcpay_payments_wrapper').slideUp('400');
                jQuery('.grcpay_progress').slideUp('400');
                if (data.is_refunded === 1) {
                    // Partial payment came in, grcpay refunded it.
                    // Show the refund-specific banner and paste in the
                    // refund txid so the customer knows where to look
                    // for their money.
                    if (data.refund_tx) {
                        jQuery('.grcpay_refund_tx').text('Refund tx: ' + data.refund_tx);
                    }
                    jQuery('.grcpay_payment_refunded').slideDown('400');
                } else {
                    jQuery('.grcpay_payment_cancelled').slideDown('400');
                }
                is_paid = true;
            }

            if (data.is_error === 1) {
                // grcpay wallet is in error state. Keep polling (merchant
                // may still manually resolve it), but show a clear
                // "we're looking into this" panel instead of the normal
                // "please send" UI so the customer understands their
                // payment is in an unusual state.
                jQuery('.grcpay_payments_wrapper').slideUp('400');
                jQuery('.grcpay_progress').slideUp('400');
                jQuery('.grcpay_payment_error').slideDown('400');
                jQuery('.grcpay_loader').remove();
            }

            // `is_pending` means grcpay has seen funds on the wallet but
            // it's still in `new` (not yet `confirming`/`funded`). That
            // covers TWO very different situations and they must not be
            // treated the same:
            //
            //   * remaining > 0 — a PARTIAL payment. The customer still
            //     owes money. Tearing down the checkout (loader, cancel
            //     timer, QR/amount) and sliding to the terminal
            //     "processing" screen would tell them they're done when
            //     they aren't, and nothing here ever reverts it. The
            //     partial-received and pending-confs notifications below
            //     already message this correctly, so we leave the
            //     checkout intact and do nothing destructive here.
            //
            //   * remaining == 0 — the full amount is in; grcpay just
            //     hasn't advanced the wallet past `new` yet. Same
            //     reassurance as a settled payment is appropriate.
            if (data.is_pending === 1 && parseFloat(data.remaining) <= 0) {
                waiting_payment.addClass('done');
                waiting_network.addClass('done');
                jQuery('.grcpay_loader').remove();
                jQuery('.grcpay_notification_refresh').remove();
                jQuery('.grcpay_notification_cancel').remove();

                setTimeout(function () {
                    jQuery('.grcpay_payments_wrapper').slideUp('400');
                    jQuery('.grcpay_payment_processing').slideDown('400');
                }, 5000);
            }

            if (data.is_paid) {
                waiting_payment.addClass('done');
                waiting_network.addClass('done');
                payment_done.addClass('done');
                jQuery('.grcpay_loader').remove();
                jQuery('.grcpay_notification_refresh').remove();
                jQuery('.grcpay_notification_cancel').remove();

                setTimeout(function () {
                    jQuery('.grcpay_payments_wrapper').slideUp('400');
                    jQuery('.grcpay_payment_processing').slideUp('400');
                    jQuery('.grcpay_payment_confirmed').slideDown('400');
                }, 5000);

                is_paid = true;
            }

            if (data.qr_code_value && /^data:image\//.test(data.qr_code_value)) {
                // Refuse anything that isn't a data:image/ URL — guards
                // against `javascript:` or remote URLs being slipped in
                // by a compromised grcpay endpoint.
                jQuery('.grcpay_qrcode').attr("src", data.qr_code_value);
            }

            if (data.show_min_fee === 1) {
                jQuery('.grcpay_notification_remaining').show();
            } else {
                jQuery('.grcpay_notification_remaining').hide();
            }

            if (data.remaining !== data.crypto_total) {
                jQuery('.grcpay_notification_payment_received').show();
                jQuery('.grcpay_notification_cancel').remove();
                jQuery('.grcpay_notification_ammount')
                    .empty()
                    .append(document.createTextNode(data.already_paid + ' ' + data.coin + ' ('))
                    .append(jQuery('<strong>').text(data.already_paid_fiat + ' ' + data.fiat_symbol))
                    .append(document.createTextNode(')'));
            }

            // Pending (unconfirmed) amount: grcpay saw a tx but it hasn't
            // reached MIN_CONFIRMATIONS yet. Show a gentle reassurance so
            // the customer doesn't think they need to resend.
            if (data.has_pending === 1) {
                jQuery('.grcpay_notification_pending_confs .grcpay_pending_amount').text(data.pending_amount + ' ' + data.coin);
                jQuery('.grcpay_notification_pending_confs').show();
            } else {
                jQuery('.grcpay_notification_pending_confs').hide();
            }

            // `confirming` status: the customer has sent enough to cover
            // the invoice (confirmed + pending), just waiting for on-chain
            // confirmations. Nothing more is required from them, so we
            // collapse the "please send X GRC", the QR code and the
            // address copy row — showing them would just be confusing
            // ("why is it still asking for money?"). What remains is the
            // info-blue confirming banner with its own spinner, plus both
            // progress icons ("waiting payment" and "waiting network")
            // flipped to .done so they glow green.
            if (data.is_confirming === 1) {
                jQuery('.grcpay_notification_confirming').show();
                jQuery('.grcpay_notification_payment_received').hide();
                jQuery('.grcpay_notification_pending_confs').hide();
                jQuery('.grcpay_notification_cancel').remove();
                jQuery('.grcpay_qrcode_wrapper').hide();
                jQuery('.grcpay_details_text').hide();
                jQuery('.grcpay_details_input').hide();
                jQuery('.grcpay_buttons_container').hide();
                jQuery('.grcpay_time_refresh').hide();
                waiting_payment.addClass('done');
                waiting_network.addClass('done');
            } else {
                jQuery('.grcpay_notification_confirming').hide();
            }

            if (data.order_history) {
                let history = data.order_history;

                if (jQuery('.grcpay_history_fill tr').length < Object.entries(history).length + 1) {
                    jQuery('.grcpay_history').show();

                    jQuery('.grcpay_history_fill td:not(.grcpay_history_header)').remove();

                    Object.entries(history).forEach(([key, value]) => {
                        let time = new Date(value.timestamp * 1000).toLocaleTimeString(document.documentElement.lang);
                        let date = new Date(value.timestamp * 1000).toLocaleDateString(document.documentElement.lang);

                        // Build via DOM construction rather than HTML
                        // string concat — value_paid / value_paid_fiat /
                        // coin / fiat_symbol all flow from the grcpay
                        // JSON response and must never be interpreted as
                        // HTML.
                        const $row = jQuery('<tr>');
                        const $tdTime = jQuery('<td>').text(time);
                        $tdTime.append(jQuery('<span>').addClass('grcpay_history_date').text(date));
                        const $tdGrc = jQuery('<td>').text(value.value_paid + ' ' + data.coin);
                        const $tdFiat = jQuery('<td>').append(
                            jQuery('<strong>').text(value.value_paid_fiat + ' ' + data.fiat_symbol)
                        );
                        $row.append($tdTime, $tdGrc, $tdFiat);
                        jQuery('.grcpay_history_fill').append($row);
                    });
                }
            }

        });

        setTimeout(status_loop, 5000);
    }

    status_loop();
}

function copyToClipboard(text) {
    if (window.clipboardData && window.clipboardData.setData) {
        return clipboardData.setData("Text", text);

    } else if (document.queryCommandSupported && document.queryCommandSupported("copy")) {
        var textarea = document.createElement("textarea");
        textarea.textContent = text;
        textarea.style.position = "fixed";
        document.body.appendChild(textarea);
        textarea.select();
        try {
            return document.execCommand("copy");
        } catch (ex) {
            console.warn("Copy to clipboard failed.", ex);
            return false;
        } finally {
            document.body.removeChild(textarea);
        }
    }
}

jQuery(function ($) {

    if ($('.grcpay_notification_cancel')[0]) {
        setInterval(function () {
            var notification_cancel = $('.grcpay_notification_cancel');

            if (notification_cancel[0]) {
                var cancel_time_span = $('.grcpay_cancel_timer'),
                    cancel_time = cancel_time_span.attr('data-timestamp') - 1;

                if (cancel_time <= 0) {
                    cancel_time_span.attr('data-timestamp', 0);
                    return;
                }

                var cancel_hours = Math.floor(cancel_time / 3600).toString().padStart(2, '0'),
                    cancel_minutes = Math.floor(cancel_time % 3600 / 60).toString().padStart(2, '0');

                if (cancel_time <= 60) {
                    notification_cancel
                        .empty()
                        .append(jQuery('<strong>').text(notification_cancel.attr('data-text') || ''));
                } else {
                    cancel_time_span.text(cancel_hours + ':' + cancel_minutes);
                }
                cancel_time_span.attr('data-timestamp', cancel_time);
            }
        }, 1000);
    }


    $('.grcpay_qrcode_btn').on('click', function () {
        $('.grcpay_qrcode_btn').removeClass('active')
        $(this).addClass('active');

        if ($(this).hasClass('no_value')) {
            $('.grcpay_qrcode.no_value').show();
            $('.grcpay_qrcode.value').hide();
        } else {
            $('.grcpay_qrcode.value').show();
            $('.grcpay_qrcode.no_value').hide();
        }
    });

    $('.grcpay_show_qr').on('click', function (e) {
        e.preventDefault();

        let qr_code_close_text = $('.grcpay_show_qr_close');
        let qr_code_open_text = $('.grcpay_show_qr_open');

        if ($(this).hasClass('active')) {
            $('.grcpay_qrcode_wrapper').slideToggle(500);
            $(this).removeClass('active');
            qr_code_close_text.addClass('active');
            qr_code_open_text.removeClass('active');

        } else {
            $('.grcpay_qrcode_wrapper').slideToggle(500);
            $(this).addClass('active');
            qr_code_close_text.removeClass('active');
            qr_code_open_text.addClass('active');
        }
    });

    $('.grcpay_copy').on('click', function () {
        copyToClipboard($(this).attr('data-tocopy'));
        let tip = $(this).find('.grcpay_tooltip.tip');
        let success = $(this).find('.grcpay_tooltip.success');

        success.show();
        tip.hide();

        setTimeout(function () {
            success.hide();
            tip.show();
        }, 5000);
    })
})