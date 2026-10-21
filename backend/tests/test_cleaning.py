import copy
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pytest
from cleaning import clean_dataset, normalize_number, normalize_date, validate_payload


def payload(headers, rows, types=None, **switches):
    types = types or ['text'] * len(headers)
    fields = [dict(name=h,type=t,key=False,missing='optional',fill='',min='',max='',allowed=[],mapping=[]) for h,t in zip(headers,types)]
    config = dict(types=types,keys=[],trim=True,nulls=True,titleCase=True,removeEmpty=True,removeEmptyColumns=True,removeDuplicates=True,caseInsensitive=True,dropInvalid=False,dateOrder='DMY',business=dict(fields=fields,crossRules=[],fuzzy=dict(enabled=False),insights=dict(enabled=False)))
    config.update(switches)
    return dict(model=dict(headers=headers,rows=rows,sourceRows=list(range(2,len(rows)+2))),config=config)


def test_empty_rows_columns_null_markers_and_identifiers():
    p=payload(['Name','Empty','Amount','NullOnly','Active','Note'],[['  alice  WANGARI ','','0','N/A','false',' null '],['Bob','  ','12','null','true','kept'],['']*6,['ALICE WANGARI','','0','N/A','false','null'],['Cara','','N/A','-','false','Missing amount']],['name','text','number','text','text','text'])
    untouched=copy.deepcopy(p)
    original,frame,r,before=clean_dataset(p)
    assert p==untouched
    assert r['outputHeaders']==['Name','Amount','Active','Note']
    assert [[row[i] for i in r['outputColumnIndices']] for row in r['rows']]==[['Alice Wangari','0','false',''],['Bob','12','true','kept'],['Cara','','false','Missing amount']]
    assert r['sourceRows']==[2,3,6]
    assert {k:r['stats'][k] for k in ['output','empty','emptyColumns','duplicates','nulls']}==dict(output=3,empty=1,emptyColumns=2,duplicates=1,nulls=7)
    assert before['missing']==17 and r['nullAnalysis']['missing']==2
    assert r['nullAnalysis']['cellCount']==12


def test_required_fields_fills_and_explicit_policies():
    p=payload(['ID','Required','Fill','Unused'],[['001','','NaN',''],['002','','NaT',''],['003','','null','']])
    p['config']['business']['fields'][1]['missing']='review'
    p['config']['business']['fields'][2].update(missing='fill',fill='chosen')
    _,_,r,_=clean_dataset(p)
    assert r['outputHeaders']==['ID','Required','Fill']
    assert r['rows'][0]==['001','','chosen','']
    assert r['stats']['filled']==3 and r['stats']['review']==3
    assert r['quality']['requiredMissing']==3
    p['config']['business']['fields'][1]['missing']='drop'
    _,_,r,_=clean_dataset(p)
    assert r['stats']['businessDropped']==3 and not r['rows']
    assert len(r['outputHeaders'])==4


def test_empty_rows_not_resurrected_and_schema_never_disappears():
    p=payload(['A','B'],[['null','NaN'],['  ','']])
    p['config']['business']['fields'][0].update(missing='fill',fill='do not resurrect')
    _,_,r,_=clean_dataset(p)
    assert not r['rows'] and r['stats']['empty']==2 and r['stats']['filled']==0
    p=payload(['A','B'],[['','']],removeEmpty=False)
    _,_,r,_=clean_dataset(p)
    assert r['outputHeaders']==['A','B'] and r['rows']==[['','']]


def test_type_checks_preserve_invalid_values_and_decimal_precision():
    p=payload(['ID','Amount','Date','Email','Phone'],[['000123','KES 9,007,199,254,740,993.00100','29/02/2024','Person@Example.COM','0712345678'],['000124','12,34','31/02/2024','bad@@example','07extension'] ],['text','number','date','email','phone'])
    _,_,r,_=clean_dataset(p)
    assert r['rows'][0]==['000123','9007199254740993.001','2024-02-29','person@example.com','+254712345678']
    assert r['rows'][1]==p['model']['rows'][1]
    assert r['stats']['review']==1 and r['stats']['invalid']==4
    p['config']['dropInvalid']=True
    _,_,r,_=clean_dataset(p)
    assert r['stats']['dropped']==1 and len(r['rows'])==1
    assert normalize_date('03/04/2024','MDY')[0]=='2024-03-04'
    assert normalize_number('(KES 5)')[1] is not None


def test_blank_and_invalid_keys_do_not_deduplicate():
    p=payload(['Email','Value'],[['','x'],['','x'],['bad','x'],['bad','x'],['A@EXAMPLE.COM','x'],['a@example.com','different']],['email','text'])
    p['config']['keys']=[0];p['config']['business']['fields'][0]['key']=True
    _,_,r,_=clean_dataset(p)
    assert len(r['rows'])==5 and r['stats']['duplicates']==1
    p['config']['removeDuplicates']=False
    assert clean_dataset(p)[2]['stats']['output']==6


def test_business_categories_bounds_and_exact_total_checks():
    p=payload(['Qty','Price','Total','Category'],[['3','9007199254740993.001','27021597764222979.003','nai'],['2','10','19','bad']],['number','number','number','text'])
    p['config']['business']['fields'][0].update(min='0',max='10')
    p['config']['business']['fields'][3].update(mapping=[{'from':'nai','to':'Nairobi'}],allowed=['Nairobi'])
    p['config']['business']['crossRules']=[dict(kind='total',qty=0,price=1,total=2,tolerance=0.001,severity='warning')]
    _,_,r,_=clean_dataset(p)
    assert r['rows'][0][3]=='Nairobi'
    assert r['quality']['consistencyChecked']==2 and r['quality']['consistencyFailed']==1
    assert r['quality']['warnings']==1 and r['quality']['errors']==1


def test_null_conversion_independent_of_trimming_and_analysis_of_unconverted_markers():
    p=payload(['ID','Value'],[['001',' NaN '],['002','NaT']],trim=False)
    assert clean_dataset(p)[2]['stats']['nulls']==2
    p['config']['nulls']=False
    _,_,r,_=clean_dataset(p)
    assert r['nullAnalysis']['missing']==2 and r['stats']['nulls']==0
    assert 'Value' in r['outputHeaders']


@pytest.mark.parametrize('mutate',[
    lambda p:p['model'].update(headers=['A','A']),
    lambda p:p['model'].update(sourceRows=[2,2]),
    lambda p:p['model']['rows'][0].__setitem__(0,{'object':'invalid'}),
    lambda p:p['config'].update(trim='true'),
    lambda p:p['config'].update(types=['unsupported','text']),
    lambda p:p['config']['business']['fields'][0].update(missing='fill',fill='null'),
    lambda p:p['config']['business']['fields'][0].update(min='10',max='1'),
    lambda p:p['config']['business']['fields'][0].update(mapping=[{'from':'a','to':'b'},{'from':'b','to':'c'}]),
])
def test_rejects_malformed_data_or_rules(mutate):
    p=payload(['A','B'],[['one','two'],['three','four']]);mutate(p)
    with pytest.raises(ValueError):validate_payload(p)
