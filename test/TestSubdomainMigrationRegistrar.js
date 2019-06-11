const ENS = artifacts.require("ENSRegistry");
const SubdomainRegistrar = artifacts.require("SubdomainRegistrar");
const PuffsRegistrarSubdomainRegistrar = artifacts.require("PuffsRegistrarSubdomainRegistrar");
const SubdomainMigrationRegistrar = artifacts.require("SubdomainMigrationRegistrar");
const PuffsRegistrar = artifacts.require("BaseRegistrarImplementation");
const HashRegistrar = artifacts.require("HashRegistrar");
const TestResolver = artifacts.require("TestResolver");

const utils = require('./helpers/Utils');

var namehash = require('puffs-ens-namehash');
const sha3 = require('web3-utils').sha3;
const { evm } = require('@ensdomains/test-utils');

const DAYS = 24 * 60 * 60;

contract('SubdomainMigrationRegistrar', function (accounts) {
    var ens = null;
    var dhr = null;
    var oldRegistrar = null;
    var resolver = null;
    var puffsregistrar = null;
    var finalRegistrar = null;

    before(async function () {
        oldRegistrar = await SubdomainRegistrar.deployed();
        ens = await ENS.deployed();
        dhr = await HashRegistrar.deployed();
        resolver = await TestResolver.deployed();

        puffsregistrar = await PuffsRegistrar.new(
            ens.address,
            dhr.address,
            namehash.hash('puffs'),
            Math.floor(Date.now() / 1000) * 2
        );
    });

    it('should migrate domain', async function () {
        await utils.registerOldNames(["yolo"], accounts[0], dhr, ens);

        await evm.advanceTime(28 * DAYS + 1);

        await dhr.transfer(sha3('yolo'), oldRegistrar.address);

        tx = await oldRegistrar.configureDomain("yolo", '10000000000000000', 100000, {from: accounts[0]});
        let domainInfo = await oldRegistrar.query(sha3('yolo'), '');
        assert.equal(domainInfo[0], 'yolo');
        assert.equal(domainInfo[1], '10000000000000000');
        assert.equal(domainInfo[2].toNumber(), 0);
        assert.equal(domainInfo[3].toNumber(), 100000);

        await ens.setSubnodeOwner('0x0', sha3('puffs'), puffsregistrar.address);

        finalRegistrar = await PuffsRegistrarSubdomainRegistrar.new(ens.address);

        let migration = await SubdomainMigrationRegistrar.new(
            oldRegistrar.address,
            finalRegistrar.address,
            dhr.address,
            puffsregistrar.address
        );

        await oldRegistrar.stop();
        await oldRegistrar.setMigrationAddress(migration.address);

        await oldRegistrar.migrate("yolo");

        domainInfo = await finalRegistrar.query(sha3('yolo'), '');
        assert.equal(domainInfo[0], 'yolo');
        assert.equal(domainInfo[1], '10000000000000000');
        assert.equal(domainInfo[2].toNumber(), 0);
        assert.equal(domainInfo[3].toNumber(), 100000);

        assert.equal(await ens.owner(namehash.hash('yolo.puffs')), finalRegistrar.address);
    });

    it("should register subdomains after migration", async function () {
        var tx = await finalRegistrar.register(sha3('yolo'), 'foo', accounts[1], accounts[2], resolver.address, {
            from: accounts[1],
            value: '10000000000000000'
        });
        assert.equal(tx.logs.length, 1);
        assert.equal(tx.logs[0].event, 'NewRegistration');
        assert.equal(tx.logs[0].args.label, sha3('yolo'));
        assert.equal(tx.logs[0].args.subdomain, 'foo');
        assert.equal(tx.logs[0].args.owner, accounts[1]);
        assert.equal(tx.logs[0].args.price, '10000000000000000');
        assert.equal(tx.logs[0].args.referrer, accounts[2]);

        // Check the new owner gets their domain
        assert.equal(await ens.owner(namehash.hash('foo.yolo.puffs')), accounts[1]);
        assert.equal(await ens.resolver(namehash.hash('foo.yolo.puffs')), resolver.address);
        assert.equal(await resolver.addr(namehash.hash('foo.yolo.puffs')), accounts[1]);
    });
});
