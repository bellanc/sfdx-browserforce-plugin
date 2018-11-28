import * as jsonMergePatch from 'json-merge-patch';
import * as queryString from 'querystring';
import { BrowserforcePlugin } from '../../../plugin';
import { removeNullValues } from '../../utils';

const PATHS = {
  LIST_VIEW: '_ui/core/portal/CustomerSuccessPortalSetup/d',
  EDIT_VIEW: '_ui/core/portal/CustomerSuccessPortalSetup/e',
  PORTAL_PROFILE_MEMBERSHIP: '_ui/core/portal/PortalProfileMembershipPage/e'
};
const SELECTORS = {
  ENABLED: '#penabled',
  SAVE_BUTTON: 'input[name="save"]',
  ERROR_DIV: '#errorTitle',
  ERROR_DIVS: 'div.errorMsg',
  LIST_VIEW_PORTAL_LINKS_XPATH:
    '//div[contains(@class,"pbBody")]//th[contains(@class,"dataCell")]//a[starts-with(@href, "/060")]',
  PORTAL_DESCRIPTION: '#Description',
  PORTAL_ADMIN: '#Admin',
  PORTAL_PROFILE_MEMBERSHIP_PROFILES: 'th.dataCell',
  PORTAL_PROFILE_MEMBERSHIP_CHECKBOXES: 'td.dataCell input',
  CUSTOM_OBJECT_AVAILABLE_FOR_CUSTOMER_PORTAL: '#options_9'
};

export default class CustomerPortalSetup extends BrowserforcePlugin {
  public async retrieve(definition?) {
    const page = this.browserforce.page;
    await page.goto(`${this.browserforce.getInstanceUrl()}/${PATHS.LIST_VIEW}`);
    await page.waitForXPath(SELECTORS.LIST_VIEW_PORTAL_LINKS_XPATH);
    const customerPortalLinks = await page.$x(
      SELECTORS.LIST_VIEW_PORTAL_LINKS_XPATH
    );
    const response = await page.evaluate((...links) => {
      return links.map((a: HTMLAnchorElement) => {
        return {
          id: a.pathname.split('/')[1],
          name: a.text,
          portalProfileMemberships: []
        };
      });
    }, ...customerPortalLinks);
    for (const portal of response) {
      await page.goto(`${this.browserforce.getInstanceUrl()}/${portal.id}/e`);
      await page.waitFor(SELECTORS.PORTAL_DESCRIPTION);
      portal.description = await page.$eval(
        SELECTORS.PORTAL_DESCRIPTION,
        (el: HTMLInputElement) => el.value
      );
      portal.adminUser = await page.$eval(
        SELECTORS.PORTAL_ADMIN,
        (el: HTMLInputElement) => el.value
      );
      // portalProfileMemberships
      await page.goto(
        `${this.browserforce.getInstanceUrl()}/${
          PATHS.PORTAL_PROFILE_MEMBERSHIP
        }?portalId=${portal.id}&setupid=CustomerSuccessPortalSettings`
      );
      await page.waitFor('#portalId');
      const profiles = await page.$$eval(
        SELECTORS.PORTAL_PROFILE_MEMBERSHIP_PROFILES,
        (ths: HTMLTableHeaderCellElement[]) => {
          return ths.map(th => th.innerText.trim());
        }
      );
      const checkboxes = await page.$$eval(
        SELECTORS.PORTAL_PROFILE_MEMBERSHIP_CHECKBOXES,
        (inputs: HTMLInputElement[]) => {
          return inputs.map(input => {
            return {
              active: input.checked,
              id: input.id
            };
          });
        }
      );
      const portalProfileMemberships = [];
      for (let i = 0; i < profiles.length; i++) {
        portalProfileMemberships.push({
          name: profiles[i],
          active: checkboxes[i].active,
          id: checkboxes[i].id
        });
      }
      portal['portalProfileMemberships'] = portalProfileMemberships;
    }
    return response;
  }

  public diff(source, target) {
    const response = [];
    if (source && target) {
      for (const portal of target) {
        let sourcePortal = source.find(p => p.name === portal.name);
        if (portal.oldName && !sourcePortal) {
          // fallback to old name of portal
          sourcePortal = source.find(p => p.name === portal.oldName);
        }
        if (!sourcePortal) {
          throw new Error(
            `Portal with name '${portal.name} (oldName: ${
              portal.oldName
            })' not found. Setting up new Portals is not yet supported.`
          );
        }
        delete portal['oldName'];
        if (sourcePortal) {
          // rename sourcePortal for generating patch
          sourcePortal.name = portal.name;
          // move id of existing portal to new portal to be retained and used
          portal.id = sourcePortal.id;
          delete sourcePortal.id;
        }
        if (
          sourcePortal.portalProfileMemberships &&
          portal.portalProfileMemberships
        ) {
          const membershipResponse = [];
          for (const member of portal.portalProfileMemberships) {
            // move id of existing member to new member to be retained and used
            const sourceMember = sourcePortal.portalProfileMemberships.find(
              m => m.name === member.name
            );
            if (sourceMember) {
              member.id = sourceMember.id;
              delete sourceMember.id;
            } else {
              throw new Error(
                `Could not find portal profile membership for '${member.name}'`
              );
            }
            membershipResponse.push(
              removeNullValues(jsonMergePatch.generate(sourceMember, member))
            );
          }
          delete sourcePortal.portalProfileMemberships;
          delete portal.portalProfileMemberships;
          if (membershipResponse.length) {
            portal.portalProfileMemberships = membershipResponse;
          }
        }
        response.push(
          removeNullValues(jsonMergePatch.generate(sourcePortal, portal))
        );
      }
    }
    return response;
  }

  public async apply(config) {
    const page = this.browserforce.page;
    for (const portal of config) {
      if (portal.id) {
        // everything that can be changed using the url
        const urlAttributes = {};
        if (portal.name) {
          urlAttributes['Name'] = portal.name;
        }
        if (portal.description) {
          urlAttributes['Description'] = portal.description;
        }
        if (portal.adminUser) {
          urlAttributes['Admin'] = portal.adminUser;
        }
        if (portal.isSelfRegistrationActivated !== undefined) {
          urlAttributes[
            'IsSelfRegistrationActivated'
          ] = portal.isSelfRegistrationActivated ? 1 : 0;
        }
        await page.goto(
          `${this.browserforce.getInstanceUrl()}/${
            portal.id
          }/e?${queryString.stringify(urlAttributes)}`
        );
        await page.waitFor(SELECTORS.PORTAL_DESCRIPTION);
        if (portal.selfRegUserDefaultLicense) {
          const licenseValue = await page.evaluate(
            option => option.value,
            (await page.$x(
              `//select[@id="SelfRegUserDefaultLicense"]//option[text()="${
                portal.selfRegUserDefaultLicense
              }"]`
            ))[0]
          );
          await page.select('select#SelfRegUserDefaultLicense', licenseValue);
        }
        if (portal.selfRegUserDefaultRole) {
          const roleValue = await page.evaluate(
            option => option.value,
            (await page.$x(
              `//select[@id="SelfRegUserDefaultRole"]//option[text()="${
                portal.selfRegUserDefaultRole
              }"]`
            ))[0]
          );
          await page.select('select#SelfRegUserDefaultRole', roleValue);
        }
        if (portal.selfRegUserDefaultProfile) {
          const profileValue = await page.evaluate(
            option => option.value,
            (await page.$x(
              `//select[@id="SelfRegUserDefaultProfile"]//option[text()="${
                portal.selfRegUserDefaultProfile
              }"]`
            ))[0]
          );
          await page.select('select#SelfRegUserDefaultProfile', profileValue);
        }
        await page.waitFor(SELECTORS.SAVE_BUTTON);
        await Promise.all([
          page.waitForNavigation({
            waitUntil: ['load', 'domcontentloaded', 'networkidle0']
          }),
          page.click(SELECTORS.SAVE_BUTTON)
        ]);
        if ((await page.url()).includes(portal.id)) {
          // error handling
          await page.waitFor(SELECTORS.PORTAL_DESCRIPTION);
          const errorElements = await page.$$(SELECTORS.ERROR_DIVS);
          if (errorElements.length) {
            const errorMessages = await page.evaluate((...errorDivs) => {
              return errorDivs.map((div: HTMLDivElement) => div.innerText);
            }, ...errorElements);
            throw new Error(errorMessages.join(' '));
          }
        }
        // portalProfileMemberships
        const membershipUrlAttributes = {};
        for (const member of portal.portalProfileMemberships) {
          membershipUrlAttributes[member.id] = member.active ? 1 : 0;
        }
        await page.goto(
          `${this.browserforce.getInstanceUrl()}/${
            PATHS.PORTAL_PROFILE_MEMBERSHIP
          }?portalId=${
            portal.id
          }&setupid=CustomerSuccessPortalSettings&${queryString.stringify(
            membershipUrlAttributes
          )}`
        );
        await page.waitFor(SELECTORS.SAVE_BUTTON);
        await Promise.all([
          page.waitForNavigation(),
          page.click(SELECTORS.SAVE_BUTTON)
        ]);
      }
    }
  }
}